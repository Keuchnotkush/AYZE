import "server-only";
import type { SubmittableTransaction, VaultDeposit, VaultWithdraw } from "xrpl";
import { dropsToXrp, toXRPL, type Drops } from "./amounts";
import { AyzeError } from "./errors";
import { planGuarantee } from "./guarantees";
import { createdIndex, getShareBalance, getSpendableBalance, getValidatedTx, getVaultState } from "./ledger";
import { updateRegistry, type EscrowRecord, type Loan, type User, type Vault } from "./registry";
import { getClient } from "./xrpl";

/* Extension-signed flows (Crossmark / GemWallet). The server never sees a key: it prepares the
   transaction JSON (autofilled, minus LastLedgerSequence so a slow signer is not timed out), the
   browser has the extension sign and submit it, and the server verifies the resulting hash on the
   ledger before touching the registry. Same pre-checks as the custodial path. */

export type PreparedTx = Record<string, unknown>;

const requireExtension = (user: User) => {
  if (!user.provider) throw new AyzeError("AYZE_INVALID_INPUT", "This wallet is not connected through a browser extension.");
};

/** Autofills for the extension: Fee and Sequence set, LastLedgerSequence removed. */
async function prepare(tx: SubmittableTransaction, sequenceOffset = 0): Promise<PreparedTx> {
  const client = await getClient();
  const filled = (await client.autofill(tx)) as PreparedTx & { Sequence?: number; LastLedgerSequence?: number };
  if (sequenceOffset && typeof filled.Sequence === "number") filled.Sequence += sequenceOffset;
  delete filled.LastLedgerSequence;
  return filled;
}

/** The validated transaction behind `hash`, checked to be `type` sent by `account` and successful. */
async function expectValidated(hash: string, account: string, type: string) {
  const found = await getValidatedTx(hash);
  if (!found) throw new AyzeError("AYZE_NOT_FOUND", `Transaction ${hash.slice(0, 10)}… is not validated on the ledger (yet).`);
  if (found.tx.Account !== account || found.tx.TransactionType !== type) {
    throw new AyzeError("AYZE_INVALID_INPUT", `Transaction ${hash.slice(0, 10)}… is not a ${type} from this wallet.`);
  }
  const code = String(found.meta.TransactionResult ?? "");
  if (code !== "tesSUCCESS") throw new AyzeError(`XRPL_${code}`, `Ledger rejected the transaction: ${code}`, hash);
  return found;
}

/* ------------------------------------------------------------------ */
/* Lender                                                              */
/* ------------------------------------------------------------------ */

export async function prepareDeposit(lender: User, vault: Vault, amount: Drops): Promise<PreparedTx> {
  requireExtension(lender);
  const balance = await getSpendableBalance(lender.wallet.address, 1);
  if (balance < amount) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", `Wallet can spend ${dropsToXrp(balance)} XRP (after reserve).`);
  const tx: VaultDeposit = { TransactionType: "VaultDeposit", Account: lender.wallet.address, VaultID: vault.vaultID, Amount: toXRPL(amount) };
  return prepare(tx);
}

/** Confirms the VaultDeposit on the ledger and records the lender against the vault. */
export async function recordDeposit(lender: User, vault: Vault, hash: string): Promise<void> {
  const { tx } = await expectValidated(hash, lender.wallet.address, "VaultDeposit");
  if (tx.VaultID !== vault.vaultID) throw new AyzeError("AYZE_INVALID_INPUT", "That deposit targets another vault.");
  await updateRegistry((r) => {
    if (!r.deposits.some((d) => d.vaultID === vault.vaultID && d.lenderId === lender.id)) {
      r.deposits.push({ vaultID: vault.vaultID, lenderId: lender.id });
    }
  });
}

export async function prepareWithdraw(lender: User, vault: Vault, amount: Drops | null): Promise<PreparedTx> {
  requireExtension(lender);
  const state = await getVaultState(vault.vaultID);
  if (!state) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found on the ledger.");
  let Amount: VaultWithdraw["Amount"];
  if (amount) {
    Amount = toXRPL(amount);
  } else {
    const shares = await getShareBalance(lender.wallet.address, state.shareMPTID);
    if (shares === 0n) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", "No shares to redeem in this vault.");
    Amount = { mpt_issuance_id: state.shareMPTID, value: shares.toString() };
  }
  const tx: VaultWithdraw = { TransactionType: "VaultWithdraw", Account: lender.wallet.address, VaultID: vault.vaultID, Amount, Destination: lender.wallet.address };
  return prepare(tx);
}

/* ------------------------------------------------------------------ */
/* Protection seller                                                   */
/* ------------------------------------------------------------------ */

/**
 * Plans the escrow ladder, keeps the fulfillments server-side as `loan.pendingGuarantee`, and
 * returns the EscrowCreates for the extension to sign in order (consecutive sequences).
 */
export async function prepareGuarantee(seller: User, loan: Loan): Promise<{ txs: PreparedTx[]; locked: Drops }> {
  requireExtension(seller);
  const plan = await planGuarantee(seller.wallet.address, loan);
  const txs: PreparedTx[] = [];
  for (const [k, escrow] of plan.escrows.entries()) txs.push(await prepare(escrow.tx, k));
  await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id);
    if (!target) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    if (target.guarantee) throw new AyzeError("AYZE_ALREADY_GUARANTEED", "This loan already has a protection seller.");
    target.pendingGuarantee = {
      protectionSellerId: seller.id,
      createdAt: new Date().toISOString(),
      escrows: plan.escrows.map((e) => ({ index: e.index, amount: e.amount.toString(), condition: e.condition, fulfillment: e.fulfillment, cancelAfter: e.cancelAfter })),
    };
  });
  return { txs, locked: plan.locked };
}

/**
 * Matches the validated EscrowCreates to the pending plan by Condition and turns them into the
 * loan's guarantee. Escrows the extension did not get through are simply not recorded: the message
 * tells the seller how many of the ladder are in place.
 */
export async function recordGuarantee(seller: User, loan: Loan, hashes: string[]): Promise<{ recorded: number; planned: number; locked: Drops }> {
  const pending = loan.pendingGuarantee;
  if (!pending || pending.protectionSellerId !== seller.id) throw new AyzeError("AYZE_NOT_FOUND", "No guarantee was prepared for this wallet on this loan.");
  if (loan.guarantee) throw new AyzeError("AYZE_ALREADY_GUARANTEED", "This loan already has a protection seller.");

  const escrows: EscrowRecord[] = [];
  for (const hash of hashes) {
    const { tx, meta } = await expectValidated(hash, seller.wallet.address, "EscrowCreate");
    const planned = pending.escrows.find((e) => e.condition === tx.Condition);
    if (!planned) throw new AyzeError("AYZE_INVALID_INPUT", `Escrow ${hash.slice(0, 10)}… does not belong to the prepared ladder.`);
    if (String(tx.Amount) !== planned.amount) throw new AyzeError("AYZE_INVALID_INPUT", `Escrow #${planned.index} was signed with a different amount.`);
    escrows.push({
      ...planned,
      escrowID: createdIndex(meta, "Escrow"),
      offerSequence: Number(tx.Sequence ?? 0),
      status: "LOCKED",
    });
  }
  if (escrows.length === 0) throw new AyzeError("AYZE_INVALID_INPUT", "No escrow was validated.");
  escrows.sort((a, b) => a.index - b.index);

  await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id);
    if (!target) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    if (target.guarantee) throw new AyzeError("AYZE_ALREADY_GUARANTEED", "This loan already has a protection seller.");
    target.guarantee = { protectionSellerId: seller.id, createdAt: new Date().toISOString(), escrows };
    delete target.pendingGuarantee;
  });
  return { recorded: escrows.length, planned: pending.escrows.length, locked: escrows.reduce((a, e) => a + BigInt(e.amount), 0n) };
}
