import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./env";
import type { RoleId } from "@/lib/roles";
import type { Drops } from "./amounts";

/* The registry holds the matching (who owns / deposited / guaranteed what) and the
   server-side secrets (seeds, escrow fulfillments). Every amount is read from the ledger. */

/** `seed` is present only for custodial roles (broker/borrower). Wallet-only roles
    (lender/protection-seller) never have their seed written to disk — it lives only
    in the caller's encrypted session cookie, see auth/session.ts. */
export type WalletRecord = { address: string; seed?: string };

/** XLS-70 credential held by a user: issued (`create`) then accepted (`accept`) on the ledger. */
export type CredentialRecord = { issuer: string; type: string; txHashes: { create?: string; accept: string } };

export type User = {
  id: string;
  /** Custodial roles only (broker/borrower); wallet-only roles have neither. */
  email?: string;
  passwordHash?: string;
  /** Company name for custodial roles; a short wallet address for wallet-only roles. */
  company?: string;
  role: RoleId;
  wallet: WalletRecord;
  /** Credentials issued per vault verification (AYZE_KYC + VAULT_<id>), see credentials.ts. */
  credentials?: CredentialRecord[];
  createdAt: string;
};

export type Vault = {
  id: string;
  vaultID: string;
  shareMPTID: string;
  brokerId: string;
  name: string;
  description: string;
  /** XLS-66 LoanBroker of this vault; every loan is drawn through it. Absent on vaults created before v1.1. */
  loanBrokerID?: string;
  /** First-loss cover posted at creation, drops as string (JSON has no bigint). */
  firstLoss?: string;
  /** Borrower ids holding the vault's credential (registry mirror; the ledger is the proof). */
  verifiedBorrowers?: string[];
  createdAt: string;
};

export type Deposit = { vaultID: string; lenderId: string };

export type EscrowRecord = {
  index: number;
  escrowID: string;
  offerSequence: number;
  amount: string; // drops as string (JSON has no bigint)
  condition: string;
  fulfillment: string;
  cancelAfter: number;
  /** RELEASED: cancelled by the platform after CancelAfter, funds back to the seller. EXPIRED: left the ledger otherwise. */
  status: "LOCKED" | "CLAIMED" | "RELEASED" | "EXPIRED";
  claimTxHash?: string;
  releaseTxHash?: string;
};

export type Guarantee = { protectionSellerId: string; createdAt: string; escrows: EscrowRecord[] };

export type InstalmentRecord = {
  index: number;
  dueDate: number;
  principal: string;
  interest: string;
  paidTxHash?: string;
  /** Last auto-debit attempt by the servicing loop (ISO date) and its error, if any. */
  lastAttemptAt?: string;
  lastAttemptError?: string;
};

export type LoanStatus = "active" | "repaid" | "defaulted" | "closed";

export type Loan = {
  id: string;
  loanID: string;
  loanBrokerID: string;
  vaultID: string;
  brokerId: string;
  borrowerId: string;
  principal: string; // drops
  paymentTotal: number;
  paymentInterval: number;
  gracePeriod: number;
  /** DEFAULT_GRACE applied at origination (= ledger GracePeriod, clamped). Absent on loans before v1.2. */
  graceSeconds?: number;
  startDate: number;
  schedule: InstalmentRecord[];
  status: LoanStatus;
  missedIndex?: number; // first unpaid instalment when defaulted
  defaultedBy?: "auto" | "broker";
  guarantee?: Guarantee;
  txHashes: { loanBrokerSet?: string; coverDeposit?: string; loanSet: string; ayzeFee?: string };
  createdAt: string;
};

export type Registry = { users: User[]; vaults: Vault[]; deposits: Deposit[]; loans: Loan[] };

const FILE = path.join(DATA_DIR, "registry.json");
const EMPTY: Registry = { users: [], vaults: [], deposits: [], loans: [] };

export function readRegistry(): Registry {
  if (!fs.existsSync(FILE)) return structuredClone(EMPTY);
  return { ...structuredClone(EMPTY), ...(JSON.parse(fs.readFileSync(FILE, "utf8")) as Registry) };
}

/* Serialise writers through a promise chain; a single Next process owns the file. */
let queue: Promise<unknown> = Promise.resolve();

export function updateRegistry<T>(mutate: (registry: Registry) => T): Promise<T> {
  const run = queue.then(() => {
    const registry = readRegistry();
    const result = mutate(registry);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(registry, null, 2));
    fs.renameSync(tmp, FILE);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export const newId = () => randomUUID();

export const drops = (value: string): Drops => BigInt(value);

/* Lookups */

export const findUser = (id: string) => readRegistry().users.find((u) => u.id === id) ?? null;
export const findUserByEmail = (email: string) =>
  readRegistry().users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
export const findUserByWallet = (address: string, role: RoleId) =>
  readRegistry().users.find((u) => u.wallet.address === address && u.role === role) ?? null;
export const findVault = (id: string) => readRegistry().vaults.find((v) => v.id === id || v.vaultID === id) ?? null;
export const findLoan = (id: string) => readRegistry().loans.find((l) => l.id === id || l.loanID === id) ?? null;
