"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isRoleId } from "@/lib/roles";
import { registerUser } from "./accounts";
import { toXRPL, usd } from "./amounts";
import { verifyPassword } from "./auth/password";
import { clearSession, currentUser, requireRole, setSession } from "./auth/session";

import { AyzeError } from "./errors";
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
  const value = usd(raw);
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
  if (!user || !verifyPassword(password, user.passwordHash)) {
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
/* Broker                                                              */
/* ------------------------------------------------------------------ */

export async function createVaultAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const result = await run(async () => {
    const broker = await requireRole("broker");
    const name = text(formData, "name");
    if (!name) throw new AyzeError("AYZE_INVALID_INPUT", "Give the vault a name.");
    const { vault, hash } = await createVault(broker, name, text(formData, "description"));
    return { message: `Vault "${vault.name}" created.`, hashes: [hash] };
  }, ["/broker", "/market"]);
  return result;
}

export async function declareDefaultAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const broker = await requireRole("broker");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan || loan.brokerId !== broker.id) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const result = await declareDefault(broker, loan);
    const claim = result.claim ? ` Insurance claimed: ${toXRPL(result.claim.claimed)} USD.` : "";
    return {
      message: `Loan defaulted at instalment #${result.missedIndex}; ${toXRPL(result.coverApplied)} USD of cover moved to the vault.${claim}`,
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
    return { message: `${toXRPL(claimed)} USD released from the protection seller's escrows.`, hashes };
  }, ["/broker", "/protect"]);
}

export async function closeLoanAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const broker = await requireRole("broker");
    const loan = findLoan(text(formData, "loanId"));
    if (!loan || loan.brokerId !== broker.id) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    const hashes = await closeLoan(broker, loan);
    return { message: "Loan closed; remaining cover returned to your wallet.", hashes };
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
    return { message: `Deposited ${toXRPL(value)} USD into ${vault.name}.`, hashes: [hash] };
  }, ["/market", "/broker"]);
}

export async function withdrawAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const lender = await requireRole("lender");
    const vault = findVault(text(formData, "vaultId"));
    if (!vault) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found.");
    const value = amount(formData, "amount");
    const hash = await withdraw(lender, vault, value);
    return { message: value ? `Withdrew ${toXRPL(value)} USD from ${vault.name}.` : `Redeemed all shares of ${vault.name}.`, hashes: [hash] };
  }, ["/market", "/broker"]);
}

/* ------------------------------------------------------------------ */
/* Borrower                                                            */
/* ------------------------------------------------------------------ */

export async function borrowAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const borrower = await requireRole("borrower");
    const vault = findVault(text(formData, "vaultId"));
    if (!vault) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found.");
    const terms = {
      paymentTotal: integer(formData, "paymentTotal"),
      paymentInterval: integer(formData, "paymentInterval"),
      gracePeriod: integer(formData, "gracePeriod"),
    };
    const { loan, hashes } = await borrow(borrower, vault, terms);
    return {
      message: `Loan of ${toXRPL(BigInt(loan.principal))} USD drawn from ${vault.name} in ${loan.paymentTotal} instalments.`,
      hashes: [hashes.loanBrokerSet, hashes.coverDeposit, hashes.loanSet, ...(hashes.ayzeFee ? [hashes.ayzeFee] : [])],
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
      message: `Instalment #${p.index} paid: ${toXRPL(p.principal)} USD principal + ${toXRPL(p.interest)} USD interest (PS ${toXRPL(p.toProtectionSeller)}, broker ${toXRPL(p.toBroker)}, lenders ${toXRPL(p.toLenders.reduce((a, l) => a + l.amount, 0n))}).`,
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
    return { message: `${toXRPL(locked)} USD locked in ${hashes.length} escrows to the broker.`, hashes };
  }, ["/protect", "/broker", "/borrower"]);
}

export async function whoami() {
  return currentUser();
}
