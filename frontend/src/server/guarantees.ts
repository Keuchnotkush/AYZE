import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { EscrowCreate, EscrowFinish } from "xrpl";
import { walletOf } from "./accounts";
import { bps, dropsToXrp, toXRPL, type Drops } from "./amounts";
import { CLAIM_WINDOW, PROTECTION_BPS } from "./economics";
import { AyzeError } from "./errors";
import { createdIndex, getLiveEscrows, getSpendableBalance, ledgerTime } from "./ledger";
import { findUser, updateRegistry, type EscrowRecord, type Loan, type User } from "./registry";
import { submit } from "./xrpl";

/* Native-XRP conditional escrows: one per remaining instalment, protection seller → broker.
   The fulfillment (preimage) stays in the registry; the broker can only finish after a default. */

/** PREIMAGE-SHA-256 crypto-condition (RFC draft-thomas-crypto-conditions) for a 32-byte preimage. */
function cryptoCondition() {
  const preimage = randomBytes(32);
  const digest = createHash("sha256").update(preimage).digest("hex").toUpperCase();
  return {
    condition: `A0258020${digest}810120`,
    fulfillment: `A0228020${preimage.toString("hex").toUpperCase()}`,
  };
}

export type PlannedEscrow = {
  index: number;
  amount: Drops;
  condition: string;
  fulfillment: string;
  cancelAfter: number;
  tx: EscrowCreate;
};

/**
 * The escrow ladder a protection seller at `sellerAddress` must post for `loan`: one conditional
 * EscrowCreate per unpaid instalment, 40 % of its principal, cancellable after due + grace + claim
 * window. Checks the loan is open and the seller can afford the ladder (one owner reserve per escrow).
 */
export async function planGuarantee(sellerAddress: string, loan: Loan): Promise<{ escrows: PlannedEscrow[]; locked: Drops; brokerAddress: string }> {
  if (loan.guarantee) throw new AyzeError("AYZE_ALREADY_GUARANTEED", "This loan already has a protection seller.");
  if (loan.status !== "active") throw new AyzeError("AYZE_LOAN_CLOSED", "This loan is no longer active.");
  const broker = findUser(loan.brokerId);
  if (!broker) throw new AyzeError("AYZE_NOT_FOUND", "Broker not found.");

  const remaining = loan.schedule.filter((i) => !i.paidTxHash);
  const amounts = remaining.map((i) => bps(BigInt(i.principal), PROTECTION_BPS));
  const locked = amounts.reduce((a, b) => a + b, 0n);
  const balance = await getSpendableBalance(sellerAddress, remaining.length);
  if (balance < locked) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", `Guaranteeing needs ${dropsToXrp(locked)} XRP; wallet can spend ${dropsToXrp(balance)} (after reserve).`);

  const escrows = remaining.map((instalment, k): PlannedEscrow => {
    const { condition, fulfillment } = cryptoCondition();
    const cancelAfter = instalment.dueDate + (loan.graceSeconds ?? loan.gracePeriod) + CLAIM_WINDOW;
    return {
      index: instalment.index,
      amount: amounts[k],
      condition,
      fulfillment,
      cancelAfter,
      tx: {
        TransactionType: "EscrowCreate",
        Account: sellerAddress,
        Destination: broker.wallet.address,
        Amount: toXRPL(amounts[k]),
        Condition: condition,
        CancelAfter: cancelAfter,
      },
    };
  });
  return { escrows, locked, brokerAddress: broker.wallet.address };
}

export async function guaranteeLoan(seller: User, loan: Loan): Promise<{ hashes: string[]; locked: Drops }> {
  const wallet = walletOf(seller);
  const plan = await planGuarantee(wallet.address, loan);

  const escrows: EscrowRecord[] = [];
  const hashes: string[] = [];
  for (const planned of plan.escrows) {
    const { hash, meta, sequence } = await submit(planned.tx, wallet);
    hashes.push(hash);
    escrows.push({
      index: planned.index,
      escrowID: createdIndex(meta, "Escrow"),
      offerSequence: sequence,
      amount: planned.amount.toString(),
      condition: planned.condition,
      fulfillment: planned.fulfillment,
      cancelAfter: planned.cancelAfter,
      status: "LOCKED",
    });
  }
  const locked = plan.locked;

  await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id);
    if (!target) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    if (target.guarantee) throw new AyzeError("AYZE_ALREADY_GUARANTEED", "This loan already has a protection seller.");
    target.guarantee = { protectionSellerId: seller.id, createdAt: new Date().toISOString(), escrows };
  });
  return { hashes, locked };
}

/** Broker finishes every escrow covering the missed instalment and the following ones. */
export async function claimInsurance(broker: User, loan: Loan): Promise<{ hashes: string[]; claimed: Drops }> {
  if (loan.status !== "defaulted") throw new AyzeError("AYZE_LOAN_NOT_DEFAULTED", "Insurance is claimable once the loan is defaulted.");
  if (!loan.guarantee) throw new AyzeError("AYZE_NOT_FOUND", "This loan has no protection seller.");
  const seller = findUser(loan.guarantee.protectionSellerId);
  if (!seller) throw new AyzeError("AYZE_NOT_FOUND", "Protection seller not found.");
  const wallet = walletOf(broker);
  const now = await ledgerTime();
  const from = loan.missedIndex ?? 1;
  const hashes: string[] = [];
  let claimed = 0n;
  for (const escrow of loan.guarantee.escrows) {
    if (escrow.status !== "LOCKED" || escrow.index < from || now >= escrow.cancelAfter) continue;
    const tx: EscrowFinish = {
      TransactionType: "EscrowFinish",
      Account: wallet.address,
      Owner: seller.wallet.address,
      OfferSequence: escrow.offerSequence,
      Condition: escrow.condition,
      Fulfillment: escrow.fulfillment,
    };
    const { hash } = await submit(tx, wallet);
    hashes.push(hash);
    claimed += BigInt(escrow.amount);
    escrow.status = "CLAIMED";
    escrow.claimTxHash = hash;
  }
  const claimedEscrows = loan.guarantee.escrows;
  await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id);
    if (target?.guarantee) target.guarantee.escrows = claimedEscrows;
  });
  if (hashes.length === 0) throw new AyzeError("AYZE_NOT_FOUND", "No claimable escrow (already claimed or expired).");
  return { hashes, claimed };
}

/** Marks escrows that left the ledger without a claim as EXPIRED (funds returned to the seller). */
export async function refreshEscrowStatuses(loan: Loan): Promise<Loan> {
  if (!loan.guarantee) return loan;
  const seller = findUser(loan.guarantee.protectionSellerId);
  if (!seller) return loan;
  const live = await getLiveEscrows(seller.wallet.address);
  let changed = false;
  for (const escrow of loan.guarantee.escrows) {
    if (escrow.status === "LOCKED" && !live.has(escrow.escrowID)) {
      escrow.status = "EXPIRED";
      changed = true;
    }
  }
  if (changed) {
    const escrows = loan.guarantee.escrows;
    await updateRegistry((r) => {
      const target = r.loans.find((l) => l.id === loan.id);
      if (target?.guarantee) target.guarantee.escrows = escrows;
    });
  }
  return loan;
}
