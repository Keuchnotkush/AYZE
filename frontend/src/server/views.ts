import "server-only";
import { shortAddress } from "@/lib/format";
import { toNumber, type Drops } from "./amounts";
import { firstLossOf, interestOf, protectionOf, TICKET } from "./economics";
import { refreshEscrowStatuses } from "./guarantees";
import { getBrokerState, getLoanState, getShareBalance, getVaultState, getXRPBalance, ledgerTime, type LoanState, type VaultState } from "./ledger";
import { readRegistry, type EscrowRecord, type InstalmentRecord, type Loan, type User, type Vault } from "./registry";

/* Read models for the pages: registry (matching) + ledger (amounts), plain XRP numbers for React. */

/** `xrp` is the raw account Balance (reserve included), the figure the explorer shows. */
export type WalletView = { address: string; xrp: number };

export async function walletView(user: User): Promise<WalletView> {
  return { address: user.wallet.address, xrp: toNumber(await getXRPBalance(user.wallet.address)) };
}

export type VaultView = {
  id: string;
  vaultID: string;
  name: string;
  description: string;
  broker: { id: string; company: string; address: string };
  /** Pseudo-account holding the vault's assets on the ledger. */
  account: string;
  loanBrokerID: string | null;
  /** First-loss cover currently available in the vault's LoanBroker. */
  coverAvailable: number;
  coverPosted: number;
  assetsTotal: number;
  assetsAvailable: number;
  pricePerShare: number;
  loans: { active: number; repaid: number; defaulted: number };
  canBorrow: boolean;
  /** Borrowers holding this vault's credential (registry mirror). */
  verifiedBorrowers: { id: string; company: string; address: string }[];
  createdAt: string;
};

function loanCounts(vaultID: string) {
  const loans = readRegistry().loans.filter((l) => l.vaultID === vaultID);
  return {
    active: loans.filter((l) => l.status === "active").length,
    repaid: loans.filter((l) => l.status === "repaid" || l.status === "closed").length,
    defaulted: loans.filter((l) => l.status === "defaulted").length,
  };
}

async function toVaultView(vault: Vault, state: VaultState | null): Promise<VaultView> {
  const users = readRegistry().users;
  const broker = users.find((u) => u.id === vault.brokerId);
  const brokerState = vault.loanBrokerID ? await getBrokerState(vault.loanBrokerID) : null;
  const verifiedBorrowers = (vault.verifiedBorrowers ?? []).flatMap((id) => {
    const u = users.find((x) => x.id === id);
    return u ? [{ id: u.id, company: u.company ?? "—", address: u.wallet.address }] : [];
  });
  return {
    id: vault.id,
    vaultID: vault.vaultID,
    name: vault.name,
    description: vault.description,
    broker: { id: vault.brokerId, company: broker?.company ?? "?", address: broker?.wallet.address ?? "" },
    account: state?.account ?? "",
    loanBrokerID: vault.loanBrokerID ?? null,
    coverAvailable: toNumber(brokerState?.coverAvailable ?? 0n),
    coverPosted: toNumber(BigInt(vault.firstLoss ?? "0")),
    assetsTotal: toNumber(state?.assetsTotal ?? 0n),
    assetsAvailable: toNumber(state?.assetsAvailable ?? 0n),
    pricePerShare: state?.pricePerShare ?? 1,
    loans: loanCounts(vault.vaultID),
    canBorrow: (state?.assetsAvailable ?? 0n) >= TICKET,
    verifiedBorrowers,
    createdAt: vault.createdAt,
  };
}

export async function listVaults(filter?: (v: Vault) => boolean): Promise<VaultView[]> {
  const vaults = readRegistry().vaults.filter(filter ?? (() => true));
  const states = await Promise.all(vaults.map((v) => getVaultState(v.vaultID)));
  return Promise.all(vaults.map((v, i) => toVaultView(v, states[i])));
}

export type PositionView = { shares: number; value: number };

export async function lenderPosition(user: User, vault: Vault): Promise<PositionView> {
  const state = await getVaultState(vault.vaultID);
  if (!state) return { shares: 0, value: 0 };
  const raw = await getShareBalance(user.wallet.address, state.shareMPTID);
  const shares = Number(raw) / 10 ** state.scale;
  return { shares, value: (shares * state.pricePerShare) };
}

export type InstalmentStatus = "paid" | "upcoming" | "due" | "late" | "defaulted";

export type InstalmentView = {
  index: number;
  dueDate: number;
  principal: number;
  interest: number;
  status: InstalmentStatus;
  txHash: string | null;
  /** Reason of the last failed auto-debit, when status is "late". */
  error: string | null;
};

function instalmentStatus(loan: Loan, i: InstalmentRecord, now: number): InstalmentStatus {
  if (i.paidTxHash) return "paid";
  if (loan.status === "defaulted" || (loan.status === "closed" && loan.missedIndex !== undefined)) return "defaulted";
  if (now < i.dueDate) return "upcoming";
  return i.lastAttemptError ? "late" : "due";
}

export type LoanView = {
  id: string;
  loanID: string;
  vault: { id: string; name: string };
  borrower: { id: string; company: string; address: string };
  broker: { id: string; company: string; address: string };
  principal: number;
  interestTotal: number;
  cover: number;
  protection: number;
  paymentTotal: number;
  paymentInterval: number;
  gracePeriod: number;
  paidCount: number;
  schedule: InstalmentView[];
  status: Loan["status"];
  ledger: LoanState | null;
  ledgerStatus: LoanState["status"] | "unknown";
  nextDue: { index: number; dueDate: number; principal: number; interest: number; secondsToDue: number; secondsToDefault: number } | null;
  guarantee: {
    seller: { id: string; company: string; address: string };
    escrows: Array<{ index: number; amount: number; cancelAfter: number; status: EscrowRecord["status"]; escrowID: string; txHash: string | null }>;
    locked: number;
    claimed: number;
    released: number;
  } | null;
  defaultedBy: Loan["defaultedBy"] | null;
  coverAvailable: number;
  txHashes: Loan["txHashes"];
  /** Set while the 0.5 % AYZE fee Payment has not validated yet (retried by servicing). */
  ayzeFeePending: string | null;
  createdAt: string;
};

export async function loanView(input: Loan): Promise<LoanView> {
  const loan = await refreshEscrowStatuses(input);
  const registry = readRegistry();
  const vault = registry.vaults.find((v) => v.vaultID === loan.vaultID);
  const borrower = registry.users.find((u) => u.id === loan.borrowerId);
  const broker = registry.users.find((u) => u.id === loan.brokerId);
  const [ledger, brokerState, now] = await Promise.all([getLoanState(loan.loanID), getBrokerState(loan.loanBrokerID), ledgerTime()]);
  const next = loan.schedule.find((i) => !i.paidTxHash) ?? null;
  const principal: Drops = BigInt(loan.principal);
  const seller = loan.guarantee ? registry.users.find((u) => u.id === loan.guarantee?.protectionSellerId) : null;
  const sum = (statuses: string[]) =>
    loan.guarantee?.escrows.filter((e) => statuses.includes(e.status)).reduce((a, e) => a + BigInt(e.amount), 0n) ?? 0n;
  return {
    id: loan.id,
    loanID: loan.loanID,
    vault: { id: vault?.id ?? "", name: vault?.name ?? "?" },
    borrower: { id: loan.borrowerId, company: borrower?.company ?? "?", address: borrower?.wallet.address ?? "" },
    broker: { id: loan.brokerId, company: broker?.company ?? "?", address: broker?.wallet.address ?? "" },
    principal: toNumber(principal),
    interestTotal: toNumber(interestOf(principal)),
    cover: toNumber(firstLossOf(principal)),
    protection: toNumber(protectionOf(principal)),
    paymentTotal: loan.paymentTotal,
    paymentInterval: loan.paymentInterval,
    gracePeriod: loan.gracePeriod,
    paidCount: loan.schedule.filter((i) => i.paidTxHash).length,
    schedule: loan.schedule.map((i) => ({
      index: i.index,
      dueDate: i.dueDate,
      principal: toNumber(BigInt(i.principal)),
      interest: toNumber(BigInt(i.interest)),
      status: instalmentStatus(loan, i, now),
      txHash: i.paidTxHash ?? null,
      error: i.paidTxHash ? null : (i.lastAttemptError ?? null),
    })),
    status: loan.status,
    ledger,
    ledgerStatus: ledger?.status ?? (loan.status === "closed" ? "deleted" : "unknown"),
    nextDue:
      next && loan.status === "active"
        ? {
            index: next.index,
            dueDate: next.dueDate,
            principal: toNumber(BigInt(next.principal)),
            interest: toNumber(BigInt(next.interest)),
            secondsToDue: next.dueDate - now,
            secondsToDefault: next.dueDate + (loan.graceSeconds ?? loan.gracePeriod) - now,
          }
        : null,
    guarantee:
      loan.guarantee && seller
        ? {
            seller: { id: seller.id, company: seller.company ?? shortAddress(seller.wallet.address), address: seller.wallet.address },
            escrows: loan.guarantee.escrows.map((e) => ({
              index: e.index,
              amount: toNumber(BigInt(e.amount)),
              cancelAfter: e.cancelAfter,
              status: e.status,
              escrowID: e.escrowID,
              txHash: e.claimTxHash ?? e.releaseTxHash ?? null,
            })),
            locked: toNumber(sum(["LOCKED"])),
            claimed: toNumber(sum(["CLAIMED"])),
            released: toNumber(sum(["RELEASED", "EXPIRED"])),
          }
        : null,
    defaultedBy: loan.status === "defaulted" || loan.status === "closed" ? (loan.defaultedBy ?? (loan.missedIndex !== undefined ? "broker" : null)) : null,
    coverAvailable: toNumber(brokerState?.coverAvailable ?? 0n),
    txHashes: loan.txHashes,
    ayzeFeePending: loan.txHashes.ayzeFee || loan.status === "closed" ? null : (loan.ayzeFeeError ?? "pending"),
    createdAt: loan.createdAt,
  };
}

export const loansWhere = (predicate: (l: Loan) => boolean) =>
  Promise.all(readRegistry().loans.filter(predicate).map(loanView));

export const TICKET_XRP = toNumber(TICKET);
