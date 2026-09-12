import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./env";
import type { RoleId } from "@/lib/roles";
import type { Micro } from "./amounts";

/* The registry holds the matching (who owns / deposited / guaranteed what) and the
   server-side secrets (seeds, escrow fulfillments). Every amount is read from the ledger. */

export type WalletRecord = { address: string; seed: string };

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  company: string;
  role: RoleId;
  wallet: WalletRecord;
  credential?: { issuer: string; type: string; txHash: string };
  createdAt: string;
};

export type Vault = {
  id: string;
  vaultID: string;
  shareMPTID: string;
  brokerId: string;
  name: string;
  description: string;
  createdAt: string;
};

export type Deposit = { vaultID: string; lenderId: string };

export type EscrowRecord = {
  index: number;
  escrowID: string;
  offerSequence: number;
  amount: string; // micro-USD as string (JSON has no bigint)
  condition: string;
  fulfillment: string;
  cancelAfter: number;
  status: "LOCKED" | "CLAIMED" | "EXPIRED";
  claimTxHash?: string;
};

export type Guarantee = { protectionSellerId: string; createdAt: string; escrows: EscrowRecord[] };

export type InstalmentRecord = { index: number; dueDate: number; principal: string; interest: string; paidTxHash?: string };

export type LoanStatus = "active" | "repaid" | "defaulted" | "closed";

export type Loan = {
  id: string;
  loanID: string;
  loanBrokerID: string;
  vaultID: string;
  brokerId: string;
  borrowerId: string;
  principal: string; // micro-USD
  paymentTotal: number;
  paymentInterval: number;
  gracePeriod: number;
  startDate: number;
  schedule: InstalmentRecord[];
  status: LoanStatus;
  missedIndex?: number; // first unpaid instalment when defaulted
  guarantee?: Guarantee;
  txHashes: { loanBrokerSet: string; coverDeposit: string; loanSet: string; ayzeFee?: string };
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

export const micro = (value: string): Micro => BigInt(value);

/* Lookups */

export const findUser = (id: string) => readRegistry().users.find((u) => u.id === id) ?? null;
export const findUserByEmail = (email: string) =>
  readRegistry().users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
export const findVault = (id: string) => readRegistry().vaults.find((v) => v.id === id || v.vaultID === id) ?? null;
export const findLoan = (id: string) => readRegistry().loans.find((l) => l.id === id || l.loanID === id) ?? null;
