import "server-only";
import { toNumber, type Micro } from "./amounts";
import { firstLossOf, interestOf, protectionOf, TICKET } from "./economics";
import { refreshEscrowStatuses } from "./guarantees";
import { getBrokerState, getLoanState, getShareBalance, getUSDBalance, getVaultState, ledgerTime, type LoanState, type VaultState } from "./ledger";
import { ensurePlatform } from "./platform";
import { readRegistry, type Loan, type User, type Vault } from "./registry";

/* Read models for the pages: registry (matching) + ledger (amounts), plain numbers for React. */

export type WalletView = { address: string; usd: number };

export async function walletView(user: User): Promise<WalletView> {
  const platform = await ensurePlatform();
  return { address: user.wallet.address, usd: toNumber(await getUSDBalance(user.wallet.address, platform.issuer.address)) };
}

export type VaultView = {
  id: string;
  vaultID: string;
  name: string;
  description: string;
  broker: { id: string; company: string; address: string };
  assetsTotal: number;
  assetsAvailable: number;
  pricePerShare: number;
  loans: { active: number; repaid: number; defaulted: number };
  canBorrow: boolean;
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
  const broker = readRegistry().users.find((u) => u.id === vault.brokerId);
  return {
    id: vault.id,
    vaultID: vault.vaultID,
    name: vault.name,
    description: vault.description,
    broker: { id: vault.brokerId, company: broker?.company ?? "?", address: broker?.wallet.address ?? "" },
    assetsTotal: toNumber(state?.assetsTotal ?? 0n),
    assetsAvailable: toNumber(state?.assetsAvailable ?? 0n),
    pricePerShare: state?.pricePerShare ?? 1,
    loans: loanCounts(vault.vaultID),
    canBorrow: (state?.assetsAvailable ?? 0n) >= TICKET,
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
  status: Loan["status"];
  ledger: LoanState | null;
  ledgerStatus: LoanState["status"] | "unknown";
  nextDue: { index: number; dueDate: number; principal: number; interest: number; secondsToDue: number; secondsToDefault: number } | null;
  guarantee: {
    seller: { id: string; company: string; address: string };
    escrows: Array<{ index: number; amount: number; cancelAfter: number; status: string; escrowID: string }>;
    locked: number;
    claimed: number;
  } | null;
  coverAvailable: number;
  txHashes: Loan["txHashes"];
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
  const principal: Micro = BigInt(loan.principal);
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
            secondsToDefault: next.dueDate + loan.gracePeriod - now,
          }
        : null,
    guarantee:
      loan.guarantee && seller
        ? {
            seller: { id: seller.id, company: seller.company, address: seller.wallet.address },
            escrows: loan.guarantee.escrows.map((e) => ({ index: e.index, amount: toNumber(BigInt(e.amount)), cancelAfter: e.cancelAfter, status: e.status, escrowID: e.escrowID })),
            locked: toNumber(sum(["LOCKED"])),
            claimed: toNumber(sum(["CLAIMED"])),
          }
        : null,
    coverAvailable: toNumber(brokerState?.coverAvailable ?? 0n),
    txHashes: loan.txHashes,
    createdAt: loan.createdAt,
  };
}

export const loansWhere = (predicate: (l: Loan) => boolean) =>
  Promise.all(readRegistry().loans.filter(predicate).map(loanView));

export const TICKET_USD = toNumber(TICKET);
