import "server-only";
import { Client, type Wallet, type SubmittableTransaction, type TxResponse } from "xrpl";
import { XRPL_WSS } from "./env";
import { AyzeError } from "./errors";

/* One shared connection per server process; survives HMR in dev. */
const globalRef = globalThis as unknown as { __ayzeClient?: Client };

export async function getClient(): Promise<Client> {
  let client = globalRef.__ayzeClient;
  if (!client) {
    client = new Client(XRPL_WSS);
    globalRef.__ayzeClient = client;
  }
  if (!client.isConnected()) await client.connect();
  return client;
}

export type SubmitResult = { hash: string; code: string; meta: unknown; sequence: number };

function outcome(result: TxResponse["result"]): SubmitResult {
  const meta = result.meta;
  const code = typeof meta === "object" && meta ? meta.TransactionResult : "unknown";
  const hash = result.hash;
  if (code !== "tesSUCCESS") throw new AyzeError(`XRPL_${code}`, `Ledger rejected the transaction: ${code}`, hash);
  const r = result as unknown as { tx_json?: { Sequence?: number }; Sequence?: number };
  return { hash, code, meta, sequence: Number(r.tx_json?.Sequence ?? r.Sequence ?? 0) };
}

/** Autofills, signs, submits and waits for validation. Throws AyzeError(XRPL_<code>) on non-tes. */
export async function submit(tx: SubmittableTransaction, wallet: Wallet): Promise<SubmitResult> {
  const client = await getClient();
  const result = await client.submitAndWait(tx, { wallet, autofill: true });
  return outcome(result.result);
}

/** Submits an already fully signed transaction (e.g. LoanSet with a counterparty signature). */
export async function submitSigned(txBlob: string): Promise<SubmitResult> {
  const client = await getClient();
  const result = await client.submitAndWait(txBlob);
  return outcome(result.result);
}
