import "server-only";
import type { EscrowCancel } from "xrpl";
import { AyzeError } from "./errors";
import { claimInsurance } from "./guarantees";
import { ledgerTime } from "./ledger";
import { declareDefault, payInstalment } from "./loans";
import { ayzeWallet, ensurePlatform } from "./platform";
import { findUser, readRegistry, updateRegistry, type Loan } from "./registry";
import { submit } from "./xrpl";

/* Loan servicing: every wallet is custodial, so the platform can debit instalments on their due
   date, declare the default once the grace period has elapsed and give the protection seller back
   the escrows that are no longer needed. Runs every SERVICING_INTERVAL_MS (instrumentation.ts)
   and on demand through POST /api/servicing/run. */

export const SERVICING_INTERVAL_MS = 15_000;

export type ServicingReport = {
  ranAt: string;
  ledgerTime: number;
  paid: Array<{ loanId: string; index: number; hashes: string[] }>;
  failed: Array<{ loanId: string; index: number; error: string }>;
  defaulted: Array<{ loanId: string; missedIndex: number; hash: string; claimed: string[] }>;
  released: Array<{ loanId: string; index: number; hash: string }>;
  errors: Array<{ loanId: string; error: string }>;
};

const message = (error: unknown) => (error instanceof AyzeError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error));

const graceOf = (loan: Loan) => loan.graceSeconds ?? loan.gracePeriod;

const fresh = (id: string) => readRegistry().loans.find((l) => l.id === id) ?? null;

/** (a) Auto-debit: every unpaid instalment that is due, in order; stops at the first failure. */
async function debit(loan: Loan, now: number, report: ServicingReport) {
  const borrower = findUser(loan.borrowerId);
  if (!borrower) throw new AyzeError("AYZE_NOT_FOUND", "Borrower not found.");
  for (;;) {
    const current = fresh(loan.id);
    if (!current || current.status !== "active") return;
    const next = current.schedule.find((i) => !i.paidTxHash);
    if (!next || next.dueDate > now) return;
    const at = new Date().toISOString();
    try {
      const p = await payInstalment(borrower, current);
      await updateRegistry((r) => {
        const target = r.loans.find((l) => l.id === loan.id)?.schedule.find((i) => i.index === next.index);
        if (target) {
          target.lastAttemptAt = at;
          delete target.lastAttemptError;
        }
      });
      report.paid.push({ loanId: loan.id, index: p.index, hashes: p.hashes });
    } catch (error) {
      const reason = message(error);
      await updateRegistry((r) => {
        const target = r.loans.find((l) => l.id === loan.id)?.schedule.find((i) => i.index === next.index);
        if (target) {
          target.lastAttemptAt = at;
          target.lastAttemptError = reason;
        }
      });
      report.failed.push({ loanId: loan.id, index: next.index, error: reason });
      console.warn(`[servicing] auto-debit failed loan=${loan.id} #${next.index}: ${reason}`);
      return;
    }
  }
}

/** (b) Auto-default once `due + DEFAULT_GRACE` is behind us; the claim is part of declareDefault. */
async function autoDefault(loan: Loan, now: number, report: ServicingReport) {
  const current = fresh(loan.id);
  if (!current || current.status !== "active") return;
  const next = current.schedule.find((i) => !i.paidTxHash);
  if (!next || now <= next.dueDate + graceOf(current)) return;
  const broker = findUser(current.brokerId);
  if (!broker) throw new AyzeError("AYZE_NOT_FOUND", "Broker not found.");
  const result = await declareDefault(broker, current, "auto");
  let claimed = result.claim?.hashes ?? [];
  if (!result.claim && current.guarantee) {
    // declareDefault swallows AyzeErrors from the claim; retry once so the report says why.
    const defaulted = fresh(loan.id);
    if (defaulted) {
      try {
        claimed = (await claimInsurance(broker, defaulted)).hashes;
      } catch (error) {
        console.warn(`[servicing] claim after auto-default failed loan=${loan.id}: ${message(error)}`);
      }
    }
  }
  report.defaulted.push({ loanId: loan.id, missedIndex: result.missedIndex, hash: result.hash, claimed });
  console.info(`[servicing] auto-default loan=${loan.id} #${result.missedIndex} ${result.hash}`);
}

/** (c) Release: EscrowCancel by the platform once CancelAfter has passed and the cover is no longer needed. */
async function release(loan: Loan, now: number, report: ServicingReport) {
  if (!loan.guarantee) return;
  const seller = findUser(loan.guarantee.protectionSellerId);
  if (!seller) return;
  const settled = loan.status === "repaid" || loan.status === "closed";
  const paid = new Set(loan.schedule.filter((i) => i.paidTxHash).map((i) => i.index));
  const candidates = loan.guarantee.escrows.filter((e) => e.status === "LOCKED" && now >= e.cancelAfter && (settled || paid.has(e.index)));
  if (candidates.length === 0) return;
  const platform = await ensurePlatform();
  const wallet = ayzeWallet(platform);
  for (const escrow of candidates) {
    const tx: EscrowCancel = {
      TransactionType: "EscrowCancel",
      Account: wallet.address,
      Owner: seller.wallet.address,
      OfferSequence: escrow.offerSequence,
    };
    try {
      const { hash } = await submit(tx, wallet);
      await updateRegistry((r) => {
        const target = r.loans.find((l) => l.id === loan.id)?.guarantee?.escrows.find((e) => e.escrowID === escrow.escrowID);
        if (target) {
          target.status = "RELEASED";
          target.releaseTxHash = hash;
        }
      });
      report.released.push({ loanId: loan.id, index: escrow.index, hash });
    } catch (error) {
      // tecNO_TARGET / entry gone: someone else cancelled it → the view marks it EXPIRED.
      console.warn(`[servicing] EscrowCancel failed loan=${loan.id} #${escrow.index}: ${message(error)}`);
    }
  }
}

let inFlight: Promise<ServicingReport> | null = null;

/** One servicing pass over the registry. Concurrent callers share the same pass. */
export function runServicing(): Promise<ServicingReport> {
  if (inFlight) return inFlight;
  inFlight = pass().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function pass(): Promise<ServicingReport> {
  const now = await ledgerTime();
  const report: ServicingReport = { ranAt: new Date().toISOString(), ledgerTime: now, paid: [], failed: [], defaulted: [], released: [], errors: [] };
  for (const loan of readRegistry().loans) {
    try {
      if (loan.status === "active") {
        await debit(loan, now, report);
        await autoDefault(loan, now, report);
      }
      const current = fresh(loan.id);
      if (current) await release(current, now, report);
    } catch (error) {
      const reason = message(error);
      report.errors.push({ loanId: loan.id, error: reason });
      console.error(`[servicing] loan=${loan.id}: ${reason}`);
    }
  }
  return report;
}

/* Background loop: one per process, survives HMR through a global. */
const globalRef = globalThis as unknown as { __ayzeServicing?: ReturnType<typeof setInterval> };

export function startServicing() {
  if (globalRef.__ayzeServicing) return;
  const tick = () => {
    runServicing().catch((error) => console.error(`[servicing] pass failed: ${message(error)}`));
  };
  globalRef.__ayzeServicing = setInterval(tick, SERVICING_INTERVAL_MS);
  globalRef.__ayzeServicing.unref?.();
  setTimeout(tick, 2_000).unref?.();
  console.info(`[servicing] started, every ${SERVICING_INTERVAL_MS / 1000}s`);
}
