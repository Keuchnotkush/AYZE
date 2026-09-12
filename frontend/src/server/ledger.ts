import "server-only";
import { fromXRPL, type Micro } from "./amounts";
import { getClient } from "./xrpl";

/* Read-only views over the validated ledger. */

type Node = Record<string, unknown>;

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
    if (error instanceof Error && error.message.includes("entryNotFound")) return null;
    throw error;
  }
}

export type VaultState = {
  vaultID: string;
  owner: string;
  account: string;
  assetsTotal: Micro;
  assetsAvailable: Micro;
  sharesOutstanding: bigint; // raw share units
  scale: number;
  shareMPTID: string;
  /** micro-USD per whole share (1e6 raw units) */
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
    if (error instanceof Error && error.message.includes("entryNotFound")) return null;
    throw error;
  }
}

export type BrokerState = { debtTotal: Micro; coverAvailable: Micro; owner: string; account: string };

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
  principalOutstanding: Micro;
  totalValueOutstanding: Micro;
  periodicPayment: Micro;
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

export async function getUSDBalance(address: string, issuer: string): Promise<Micro> {
  const client = await getClient();
  const response = await client.request({ command: "account_lines", account: address, peer: issuer });
  const line = response.result.lines.find((l) => l.currency === "USD");
  return fromXRPL(line?.balance ?? "0");
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
    if (error instanceof Error && error.message.includes("entryNotFound")) return false;
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
