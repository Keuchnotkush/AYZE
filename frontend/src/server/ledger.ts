import "server-only";
import { dropsToXrp, fromXRPL, toNumber, type Drops } from "./amounts";
import { getClient } from "./xrpl";

/* Read-only views over the validated ledger. */

type Node = Record<string, unknown>;

/**
 * True when `error` is rippled answering with `code` (e.g. entryNotFound, actNotFound).
 * xrpl.js puts rippled's human `error_message` ("Entry not found.") in `message` and the
 * code in `data.error`, so matching the message alone silently never fires.
 */
export function isRippledError(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  const data = (error as Error & { data?: { error?: string; error_code?: number } }).data;
  return data?.error === code || error.message.includes(code);
}

export async function ledgerTime(): Promise<number> {
  const client = await getClient();
  const response = await client.request({ command: "ledger", ledger_index: "validated" });
  return Number(response.result.ledger.close_time);
}

export async function ledgerEntry(index: string): Promise<Node | null> {
  const client = await getClient();
  try {
    const response = await client.request({ command: "ledger_entry", index, ledger_index: "validated" });
    return response.result.node as unknown as Node;
  } catch (error) {
    if (isRippledError(error, "entryNotFound")) return null;
    throw error;
  }
}

export type VaultState = {
  vaultID: string;
  owner: string;
  account: string;
  assetsTotal: Drops;
  assetsAvailable: Drops;
  sharesOutstanding: bigint; // raw share units
  scale: number;
  shareMPTID: string;
  /** XRP per whole share (10^scale raw units) */
  pricePerShare: number;
};

export async function getVaultState(vaultID: string): Promise<VaultState | null> {
  const client = await getClient();
  try {
    const response = await client.request({ command: "vault_info", vault_id: vaultID });
    const vault = response.result.vault as unknown as Node & { shares: { OutstandingAmount: string } };
    const assetsTotal = fromXRPL(vault.AssetsTotal as string);
    const shares = BigInt(vault.shares.OutstandingAmount ?? "0");
    const scale = Number(vault.Scale ?? 6);
    return {
      vaultID,
      owner: String(vault.Owner),
      account: String(vault.Account),
      assetsTotal,
      assetsAvailable: fromXRPL(vault.AssetsAvailable as string),
      sharesOutstanding: shares,
      scale,
      shareMPTID: String(vault.ShareMPTID),
      pricePerShare: shares > 0n ? Number(assetsTotal) / Number(shares) / 10 ** (6 - scale) : 1,
    };
  } catch (error) {
    if (isRippledError(error, "entryNotFound")) return null;
    throw error;
  }
}

export type BrokerState = { debtTotal: Drops; coverAvailable: Drops; owner: string; account: string };

export async function getBrokerState(loanBrokerID: string): Promise<BrokerState | null> {
  const node = await ledgerEntry(loanBrokerID);
  if (!node) return null;
  return {
    debtTotal: fromXRPL(node.DebtTotal as string),
    coverAvailable: fromXRPL(node.CoverAvailable as string),
    owner: String(node.Owner),
    account: String(node.Account),
  };
}

export type LedgerLoanStatus = "current" | "late" | "defaultable" | "defaulted" | "repaid" | "deleted";

export type LoanState = {
  status: LedgerLoanStatus;
  principalOutstanding: Drops;
  totalValueOutstanding: Drops;
  periodicPayment: Drops;
  paymentRemaining: number;
  nextPaymentDueDate: number | null;
  gracePeriod: number;
  startDate: number;
  flags: number;
  now: number;
};

const LSF_LOAN_DEFAULT = 0x0001_0000;

export async function getLoanState(loanID: string): Promise<LoanState | null> {
  const [node, now] = await Promise.all([ledgerEntry(loanID), ledgerTime()]);
  if (!node) return null;
  const flags = Number(node.Flags ?? 0);
  const paymentRemaining = Number(node.PaymentRemaining ?? 0);
  const nextDue = node.NextPaymentDueDate === undefined ? null : Number(node.NextPaymentDueDate);
  const grace = Number(node.GracePeriod ?? 0);
  const totalValueOutstanding = fromXRPL(node.TotalValueOutstanding as string);
  let status: LedgerLoanStatus = "current";
  if (flags & LSF_LOAN_DEFAULT) status = "defaulted";
  else if (paymentRemaining <= 0 || totalValueOutstanding === 0n) status = "repaid";
  else if (nextDue !== null && now >= nextDue + grace) status = "defaultable";
  else if (nextDue !== null && now > nextDue) status = "late";
  return {
    status,
    principalOutstanding: fromXRPL(node.PrincipalOutstanding as string),
    totalValueOutstanding,
    periodicPayment: fromXRPL(node.PeriodicPayment as string),
    paymentRemaining,
    nextPaymentDueDate: nextDue,
    gracePeriod: grace,
    startDate: Number(node.StartDate ?? 0),
    flags,
    now,
  };
}

/** Raw XRP balance in drops, as the explorer shows it. 0n when the account does not exist yet. */
export async function getXRPBalance(address: string): Promise<Drops> {
  const client = await getClient();
  try {
    const info = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    return BigInt(info.result.account_data.Balance);
  } catch (error) {
    if (isRippledError(error, "actNotFound")) return 0n;
    throw error;
  }
}

type Reserve = { base: Drops; inc: Drops };
let reserveCache: Reserve | null = null;

/** Base and per-object owner reserve of the network, in drops (cached per process). */
export async function getReserve(): Promise<Reserve> {
  if (reserveCache) return reserveCache;
  const client = await getClient();
  const response = await client.request({ command: "server_state" });
  const ledger = response.result.state.validated_ledger;
  reserveCache = { base: BigInt(ledger?.reserve_base ?? 10_000_000), inc: BigInt(ledger?.reserve_inc ?? 2_000_000) };
  return reserveCache;
}

/**
 * Balance the account can actually spend: Balance − (base + inc × OwnerCount) reserve, minus the
 * reserve of `newObjects` ledger objects the action is about to create (escrows, vault, MPToken…).
 * Used to gate actions; the UI displays the raw balance.
 */
export async function getSpendableBalance(address: string, newObjects = 0): Promise<Drops> {
  const client = await getClient();
  try {
    const [info, reserve] = await Promise.all([
      client.request({ command: "account_info", account: address, ledger_index: "validated" }),
      getReserve(),
    ]);
    const data = info.result.account_data;
    const owned = BigInt(data.OwnerCount ?? 0) + BigInt(newObjects);
    const spendable = BigInt(data.Balance) - reserve.base - reserve.inc * owned;
    return spendable > 0n ? spendable : 0n;
  } catch (error) {
    if (isRippledError(error, "actNotFound")) return 0n;
    throw error;
  }
}

export async function getShareBalance(address: string, mptIssuanceID: string): Promise<bigint> {
  const client = await getClient();
  const response = await client.request({ command: "account_objects", account: address, type: "mptoken" });
  const token = (response.result.account_objects as unknown as Node[]).find((o) => o.MPTokenIssuanceID === mptIssuanceID);
  return BigInt(String(token?.MPTAmount ?? "0"));
}

/** Escrow ledger indexes currently owned by `owner`. */
export async function getLiveEscrows(owner: string): Promise<Set<string>> {
  const client = await getClient();
  const response = await client.request({ command: "account_objects", account: owner, type: "escrow" });
  return new Set((response.result.account_objects as unknown as Node[]).map((o) => String(o.index)));
}

/** True when `subject` holds an accepted credential of `type` issued by `issuer`. */
export async function hasCredential(subject: string, issuer: string, credentialType: string): Promise<boolean> {
  const client = await getClient();
  try {
    // rippled expects snake_case here; the xrpl.js type says `credentialType`.
    const request = {
      command: "ledger_entry",
      credential: { subject, issuer, credential_type: credentialType },
      ledger_index: "validated",
    } as unknown as Parameters<typeof client.request>[0];
    const response = await client.request(request);
    const node = (response.result as unknown as { node: Node }).node;
    const LSF_ACCEPTED = 0x0001_0000;
    return (Number(node.Flags ?? 0) & LSF_ACCEPTED) !== 0;
  } catch (error) {
    if (isRippledError(error, "entryNotFound")) return false;
    throw error;
  }
}

export type ValidatedTx = { tx: Node; meta: Node; hash: string };

/**
 * A validated transaction by hash, or null when the ledger does not know it (yet). Used to check
 * what a browser extension signed before the registry records it.
 */
export async function getValidatedTx(hash: string): Promise<ValidatedTx | null> {
  const client = await getClient();
  try {
    const response = await client.request({ command: "tx", transaction: hash });
    const r = response.result as unknown as { validated?: boolean; tx_json?: Node; meta?: Node | string; hash?: string } & Node;
    if (!r.validated) return null;
    const tx = r.tx_json ?? r;
    const meta = typeof r.meta === "object" && r.meta ? r.meta : {};
    return { tx, meta, hash: String(r.hash ?? hash) };
  } catch (error) {
    if (isRippledError(error, "txnNotFound")) return null;
    throw error;
  }
}

/** Ledger index of the object of `type` created by a validated transaction. */
export function createdIndex(meta: unknown, type: string): string {
  const nodes = (meta as { AffectedNodes?: Array<{ CreatedNode?: { LedgerEntryType: string; LedgerIndex: string } }> })
    .AffectedNodes ?? [];
  const created = nodes.find((n) => n.CreatedNode?.LedgerEntryType === type)?.CreatedNode;
  if (!created) throw new Error(`${type} object not found in transaction metadata.`);
  return created.LedgerIndex;
}

/* ------------------------------------------------------------------ */
/* Account activity (raw XRP balance + last on-ledger operation)        */
/* ------------------------------------------------------------------ */

export type LastTx = {
  hash: string;
  type: string;
  /** Human-readable amount ("10 XRP", "0.000012 XRP", "1000000 shares", "—"), signed from the account's point of view. */
  amount: string;
  direction: "in" | "out" | "self";
  /** ISO date of the validated ledger close. */
  date: string | null;
  result: string;
};

export type AccountActivity = { address: string; xrp: number | null; lastTx: LastTx | null };

const RIPPLE_EPOCH = 946_684_800;

function fmtAmount(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return /^\d+$/.test(value) ? `${dropsToXrp(BigInt(value))} XRP` : null;
  if (typeof value === "object") {
    const v = value as { value?: string; currency?: string; mpt_issuance_id?: string };
    if (v.mpt_issuance_id) return `${v.value ?? "0"} shares`;
    return `${v.value ?? "0"} ${v.currency ?? ""}`.trim();
  }
  return null;
}

export async function getAccountActivity(address: string): Promise<AccountActivity> {
  const client = await getClient();
  let xrp: number | null = null;
  try {
    const info = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    xrp = toNumber(BigInt(info.result.account_data.Balance));
  } catch (error) {
    if (!isRippledError(error, "actNotFound")) throw error;
  }

  let lastTx: LastTx | null = null;
  if (xrp !== null) {
    const response = await client.request({ command: "account_tx", account: address, limit: 1, ledger_index_min: -1, ledger_index_max: -1 });
    const first = response.result.transactions[0] as unknown as
      | { hash?: string; close_time_iso?: string; tx_json?: Node; tx?: Node; meta?: Node | string }
      | undefined;
    const tx = first?.tx_json ?? first?.tx;
    if (first && tx) {
      const meta = typeof first.meta === "object" && first.meta ? first.meta : {};
      const account = String(tx.Account ?? "");
      const destination = typeof tx.Destination === "string" ? tx.Destination : null;
      const direction: LastTx["direction"] = account === address ? (destination === address ? "self" : "out") : "in";
      const raw =
        fmtAmount(meta.delivered_amount) ?? fmtAmount(tx.Amount) ?? fmtAmount(tx.PrincipalRequested) ?? fmtAmount(tx.DeliverMax);
      const amount = raw ? `${direction === "in" ? "+" : direction === "out" ? "−" : ""}${raw}` : "—";
      const seconds = typeof tx.date === "number" ? tx.date : null;
      lastTx = {
        hash: String(first.hash ?? tx.hash ?? ""),
        type: String(tx.TransactionType ?? "?"),
        amount,
        direction,
        date: first.close_time_iso ?? (seconds !== null ? new Date((seconds + RIPPLE_EPOCH) * 1000).toISOString() : null),
        result: String(meta.TransactionResult ?? ""),
      };
    }
  }
  return { address, xrp, lastTx };
}
