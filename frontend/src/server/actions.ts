"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isRoleId } from "@/lib/roles";
import type { ExtensionProvider } from "@/lib/wallet-extension";
import { connectExtensionAccount, connectWalletAccount, generateWalletAccount, registerUser } from "./accounts";
import { dropsToXrp, xrpToDrops } from "./amounts";
import { verifyPassword } from "./auth/password";
import { clearSession, currentUser, requireRole, setSession } from "./auth/session";
import { verifyBorrowerForVault } from "./credentials";

import { AyzeError } from "./errors";
import { prepareDeposit, prepareGuarantee, prepareWithdraw, recordDeposit, recordGuarantee, type PreparedTx } from "./extension";
import { claimInsurance, guaranteeLoan } from "./guarantees";
import { borrow, closeLoan, declareDefault, payInstalment, repayInFull } from "./loans";
import { findLoan, findUserByEmail, findVault } from "./registry";
import { createVault, deposit, withdraw } from "./vaults";

export type ActionResult =
  | { ok: true; message: string; hashes: string[] }
  | { ok: false; code: string; message: string; hashes: string[] }
  | null;

/** Runs an action; application and ledger errors come back as data with their code. */
async function run(work: () => Promise<{ message: string; hashes?: string[] }>, paths: string[] = ["/"]): Promise<ActionResult> {
  try {
    const result = await work();
    paths.forEach((p) => revalidatePath(p, "layout"));
    return { ok: true, message: result.message, hashes: result.hashes ?? [] };
  } catch (error) {
    paths.forEach((p) => revalidatePath(p, "layout"));
    if (error instanceof AyzeError) {
      return { ok: false, code: error.code, message: error.message, hashes: error.hash ? [error.hash] : [] };
    }
    return { ok: false, code: "AYZE_UNEXPECTED", message: error instanceof Error ? error.message : String(error), hashes: [] };
  }
}

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const integer = (formData: FormData, name: string) => {
  const value = Number(text(formData, name));
  if (!Number.isInteger(value)) throw new AyzeError("AYZE_INVALID_INPUT", `${name} must be a whole number.`);
  return value;
};

const amount = (formData: FormData, name: string) => {
  const raw = text(formData, name);
  if (!raw) return null;
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw new AyzeError("AYZE_INVALID_INPUT", `${name} must be a positive amount (max 6 decimals).`);
  const value = xrpToDrops(raw);
  if (value <= 0n) throw new AyzeError("AYZE_INVALID_INPUT", `${name} must be positive.`);
  return value;
};

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export async function register(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const role = text(formData, "role");
  const email = text(formData, "email");
  const password = text(formData, "password");
  const company = text(formData, "company");
  if (!isRoleId(role)) return { ok: false, code: "AYZE_INVALID_INPUT", message: "Choose a role to continue.", hashes: [] };
  if (!email || !password || !company) return { ok: false, code: "AYZE_INVALID_INPUT", message: "Company, email and password are required.", hashes: [] };
  const result = await run(async () => {
    const user = await registerUser({ email, password, company, role });
    await setSession(user.id);
    return { message: "Account created." };
  });
  if (result?.ok) redirect("/dashboard");
  return result;
}

export async function login(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = text(formData, "email");
  const password = text(formData, "password");
  const user = findUserByEmail(email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, code: "AYZE_BAD_CREDENTIALS", message: "Unknown email or wrong password.", hashes: [] };
  }
  await setSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await clearSession();
  redirect("/");
}

/* ------------------------------------------------------------------ */
/* Wallet-only accounts (lender / protection-seller)                   */
/* ------------------------------------------------------------------ */

export type WalletActionResult = { ok: true; address: string; seed?: string } | { ok: false; code: string; message: string } | null;

const walletError = (error: unknown): WalletActionResult => ({
  ok: false,
  code: error instanceof AyzeError ? error.code : "AYZE_UNEXPECTED",
  message: error instanceof Error ? error.message : String(error),
});

const walletRole = (formData: FormData) => {
  const role = text(formData, "role");
  return role === "lender" || role === "protection-seller" ? role : null;
};

/** Creates and funds a brand new wallet; the seed is returned once (never persisted) so the
    caller can show it, then only ever keeps it in the encrypted session cookie. */
export async function generateWalletAction(_prev: WalletActionResult, formData: FormData): Promise<WalletActionResult> {
  const role = walletRole(formData);
  if (!role) return { ok: false, code: "AYZE_INVALID_INPUT", message: "Choose lender or protection seller." };
  try {
    const { user, seed } = await generateWalletAccount(role);
    await setSession(user.id, seed);
    revalidatePath("/", "layout");
    return { ok: true, address: user.wallet.address, seed };
  } catch (error) {
    return walletError(error);
  }
}

/** Reconnects with a pasted family seed; redirects straight to the dashboard on success. */
export async function connectWalletAction(_prev: WalletActionResult, formData: FormData): Promise<WalletActionResult> {
  const role = walletRole(formData);
  const seed = text(formData, "seed");
  if (!role) return { ok: false, code: "AYZE_INVALID_INPUT", message: "Choose lender or protection seller." };
  if (!seed) return { ok: false, code: "AYZE_INVALID_INPUT", message: "Paste a wallet seed." };
  const result = await (async (): Promise<WalletActionResult> => {
    try {
      const { user, seed: connected } = await connectWalletAccount(role, seed);
      await setSession(user.id, connected);
      return { ok: true, address: user.wallet.address };
    } catch (error) {
      return walletError(error);
    }
  })();
  if (result?.ok) redirect("/dashboard");
  return result;
}

/** Connects a Crossmark / GemWallet address; the extension keeps the key, the session keeps the provider. */
export async function connectExtensionAction(role: string, address: string, provider: ExtensionProvider): Promise<WalletActionResult> {
  if (role !== "lender" && role !== "protection-seller") return { ok: false, code: "AYZE_INVALID_INPUT", message: "Choose lender or protection seller." };
  try {
    const user = await connectExtensionAccount(role, address);
    await setSession(user.id, undefined, provider);
    revalidatePath("/", "layout");
    return { ok: true, address: user.wallet.address };
  } catch (error) {
    return walletError(error);
  }
}

/* ------------------------------------------------------------------ */
/* Extension-signed transactions (lender / protection-seller)          */
/* ------------------------------------------------------------------ */

/** Unsigned transactions for the browser extension, or the reason none could be prepared. */
export type PrepareResult = { ok: true; txs: PreparedTx[]; note?: string } | { ok: false; code: string; message: string };

async function prepared(work: () => Promise<{ txs: PreparedTx[]; note?: string }>): Promise<PrepareResult> {
  try {
    return { ok: true, ...(await work()) };
  } catch (error) {
    if (error instanceof AyzeError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "AYZE_UNEXPECTED", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function prepareDepositAction(formData: FormData): Promise<PrepareResult> {
  return prepared(async () => {
    const lender = await requireRole("lender");
    const vault = findVault(text(formData, "vaultId"));
    if (!vault) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found.");
    const value = amount(formData, "amount");
    if (!value) throw new AyzeError("AYZE_INVALID_INPUT", "Enter an amount.");
    return { txs: [await prepareDeposit(lender, vault, value)] };
  });
}

export async function recordDepositAction(formData: FormData, hashes: string[]): Promise<ActionResult> {
  return run(async () => {
    const lender = await requireRole("lender");
    const vault = findVault(text(formData, "vaultId"));
    if (!vault) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found.");
    await recordDeposit(lender, vault, hashes[0] ?? "");
    return { message: `Deposited ${text(formData, "amount")} XRP into ${vault.name}.`, hashes };
  }, ["/market", "/broker"]);
}

export async function prepareWithdrawAction(formData: FormData): Promise<PrepareResult> {
  return prepared(async () => {
    const lender = await requireRole("lender");
    const vault = findVault(text(formData, "vaultId"));
    if (!vault) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found.");
    return { txs: [await prepareWithdraw(lender, vault, amount(formData, "amount"))] };
  });
}

export async function recordWithdrawAction(formData: FormData, hashes: string[]): Promise<ActionResult> {
  return run(async () => {
    await requireRole("lender");
    const vault = findVault(text(formData, "vaultId"));
    const value = text(formData, "amount");
    return { message: value ? `Withdrew ${value} XRP from ${vault?.name ?? "the vault"}.` : `Redeemed all shares of ${vault?.name ?? "the vault"}.`, hashes };
  }, ["/market", "/broker"]);
}

export async function prepareGuaranteeAction(formData: FormData): Promise<PrepareResult> {
  return prepared(async () => {
    const seller = await requireRole("protection-seller");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const { txs, locked } = await prepareGuarantee(seller, loan);
    return { txs, note: `${txs.length} escrows to sign, ${dropsToXrp(locked)} XRP in total.` };
  });
}

export async function recordGuaranteeAction(formData: FormData, hashes: string[]): Promise<ActionResult> {
  return run(async () => {
    const seller = await requireRole("protection-seller");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const { recorded, planned, locked } = await recordGuarantee(seller, loan, hashes);
    const partial = recorded < planned ? ` Only ${recorded} of ${planned} escrows validated; the remaining instalments are unprotected.` : "";
    return { message: `${dropsToXrp(locked)} XRP locked in ${recorded} escrows to the broker.${partial}`, hashes };
  }, ["/protect", "/broker", "/borrower"]);
}

/* ------------------------------------------------------------------ */
/* Broker                                                              */
/* ------------------------------------------------------------------ */

export async function createVaultAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const result = await run(async () => {
    const broker = await requireRole("broker");
    const name = text(formData, "name");
    if (!name) throw new AyzeError("AYZE_INVALID_INPUT", "Give the vault a name.");
    const firstLoss = amount(formData, "firstLoss");
    if (!firstLoss) throw new AyzeError("AYZE_INVALID_INPUT", "Enter the first-loss capital (XRP).");
    const { vault, hashes } = await createVault(broker, name, text(formData, "description"), firstLoss);
    return { message: `Vault "${vault.name}" created with ${dropsToXrp(firstLoss)} XRP of first-loss capital.`, hashes };
  }, ["/broker", "/market"]);
  return result;
}

export async function declareDefaultAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const broker = await requireRole("broker");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan || loan.brokerId !== broker.id) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const result = await declareDefault(broker, loan);
    const claim = result.claim ? ` Insurance claimed: ${dropsToXrp(result.claim.claimed)} XRP.` : "";
    return {
      message: `Loan defaulted at instalment #${result.missedIndex}; ${dropsToXrp(result.coverApplied)} XRP of cover moved to the vault.${claim}`,
      hashes: [result.hash, ...(result.claim?.hashes ?? [])],
    };
  }, ["/broker", "/borrower", "/protect", "/market"]);
}

export async function claimInsuranceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const broker = await requireRole("broker");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan || loan.brokerId !== broker.id) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const { hashes, claimed } = await claimInsurance(broker, loan);
    return { message: `${dropsToXrp(claimed)} XRP released from the protection seller's escrows.`, hashes };
  }, ["/broker", "/protect"]);
}

export async function closeLoanAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const broker = await requireRole("broker");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan || loan.brokerId !== broker.id) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const hashes = await closeLoan(broker, loan);
    return { message: "Loan closed.", hashes };
  }, ["/broker", "/market"]);
}

/* ------------------------------------------------------------------ */
/* Lender                                                              */
/* ------------------------------------------------------------------ */

export async function depositAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const lender = await requireRole("lender");
    const vault = findVault(text(formData, "vaultId"));
    if (!vault) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found.");
    const value = amount(formData, "amount");
    if (!value) throw new AyzeError("AYZE_INVALID_INPUT", "Enter an amount.");
    const hash = await deposit(lender, vault, value);
    return { message: `Deposited ${dropsToXrp(value)} XRP into ${vault.name}.`, hashes: [hash] };
  }, ["/market", "/broker"]);
}

export async function withdrawAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const lender = await requireRole("lender");
    const vault = findVault(text(formData, "vaultId"));
    if (!vault) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found.");
    const value = amount(formData, "amount");
    const hash = await withdraw(lender, vault, value);
    return { message: value ? `Withdrew ${dropsToXrp(value)} XRP from ${vault.name}.` : `Redeemed all shares of ${vault.name}.`, hashes: [hash] };
  }, ["/market", "/broker"]);
}

/* ------------------------------------------------------------------ */
/* Borrower                                                            */
/* ------------------------------------------------------------------ */

export async function beVerifiedAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const borrower = await requireRole("borrower");
    const vault = findVault(text(formData, "vaultId"));
    if (!vault) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found.");
    const { hashes, issued } = await verifyBorrowerForVault(borrower, vault);
    return { message: issued.length ? `Verified for ${vault.name} (${issued.length} credential${issued.length > 1 ? "s" : ""} issued).` : `Already verified for ${vault.name}.`, hashes };
  }, ["/market", "/borrower", "/broker"]);
}

export async function borrowAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const borrower = await requireRole("borrower");
    const vault = findVault(text(formData, "vaultId"));
    if (!vault) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found.");
    const terms = {
      paymentTotal: integer(formData, "paymentTotal"),
      paymentInterval: integer(formData, "paymentInterval"),
    };
    const { loan, hashes } = await borrow(borrower, vault, terms);
    return {
      message: `Loan of ${dropsToXrp(BigInt(loan.principal))} XRP drawn from ${vault.name} in ${loan.paymentTotal} instalments (grace ${loan.gracePeriod}s, auto-debited).${hashes.ayzeFee ? "" : " AYZE fee not collected yet; servicing will retry."}`,
      hashes: [hashes.loanSet, ...(hashes.ayzeFee ? [hashes.ayzeFee] : [])],
    };
  }, ["/borrower", "/market", "/broker", "/protect"]);
}

export async function payInstalmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const borrower = await requireRole("borrower");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan || loan.borrowerId !== borrower.id) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const p = await payInstalment(borrower, loan);
    return {
      message: `Instalment #${p.index} paid: ${dropsToXrp(p.principal)} XRP principal + ${dropsToXrp(p.interest)} XRP interest (PS ${dropsToXrp(p.toProtectionSeller)}, broker ${dropsToXrp(p.toBroker)}, lenders ${dropsToXrp(p.toLenders.reduce((a, l) => a + l.amount, 0n))}).`,
      hashes: p.hashes,
    };
  }, ["/borrower", "/broker", "/protect", "/market"]);
}

export async function repayInFullAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const borrower = await requireRole("borrower");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan || loan.borrowerId !== borrower.id) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const payments = await repayInFull(borrower, loan);
    return { message: `Loan repaid in full (${payments.length} instalments).`, hashes: payments.flatMap((p) => p.hashes) };
  }, ["/borrower", "/broker", "/protect", "/market"]);
}

/* ------------------------------------------------------------------ */
/* Protection seller                                                   */
/* ------------------------------------------------------------------ */

export async function guaranteeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const seller = await requireRole("protection-seller");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const { hashes, locked } = await guaranteeLoan(seller, loan);
    return { message: `${dropsToXrp(locked)} XRP locked in ${hashes.length} escrows to the broker.`, hashes };
  }, ["/protect", "/broker", "/borrower"]);
}

export async function whoami() {
  return currentUser();
}
