import "server-only";
import {
  decode,
  signLoanSetByCounterparty,
  LoanManageFlags,
  LoanPayFlags,
  type LoanBrokerCoverWithdraw,
  type LoanBrokerDelete,
  type LoanDelete,
  type LoanManage,
  type LoanPay,
  type LoanSet,
} from "xrpl";
import { walletOf } from "./accounts";
import { assertVaultAccess } from "./credentials";
import { dropsToXrp, splitProRata, toXRPL, type Drops } from "./amounts";
import {
  ayzeFeeOf,
  buildSchedule,
  defaultGrace,
  firstLossOf,
  splitInterest,
  TICKET,
  validateTerms,
  type Terms,
} from "./economics";
import { AyzeError } from "./errors";
import { createdIndex, getBrokerState, getLoanState, getShareBalance, getSpendableBalance, getVaultState, ledgerEntry } from "./ledger";
import { ayzeWallet, ensurePlatform, sendXRP } from "./platform";
import { claimInsurance } from "./guarantees";
import { findUser, newId, readRegistry, updateRegistry, type Loan, type User, type Vault } from "./registry";
import { getClient, submit, submitSigned } from "./xrpl";

/* XLS-66 loans. Every loan of a vault is drawn through the vault's LoanBroker,
   created and funded with first-loss capital when the broker opens the vault. */

export type BorrowResult = { loan: Loan; hashes: Loan["txHashes"] };

export async function borrow(borrower: User, vault: Vault, terms: Terms): Promise<BorrowResult> {
  const invalid = validateTerms(terms);
  if (invalid) throw new AyzeError("AYZE_INVALID_TERMS", invalid);
  await assertVaultAccess(borrower, vault);

  const broker = findUser(vault.brokerId);
  if (!broker) throw new AyzeError("AYZE_NOT_FOUND", "Broker not found.");
  const state = await getVaultState(vault.vaultID);
  if (!state) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found on the ledger.");
  if (state.assetsAvailable < TICKET) {
    throw new AyzeError("AYZE_INSUFFICIENT_LIQUIDITY", `Vault has ${dropsToXrp(state.assetsAvailable)} XRP available; the ticket is ${dropsToXrp(TICKET)}.`);
  }
  if (!vault.loanBrokerID) throw new AyzeError("AYZE_NOT_FOUND", "This vault has no LoanBroker; the broker must recreate it with first-loss capital.");
  const loanBrokerID = vault.loanBrokerID;
  const cover = firstLossOf(TICKET);
  const brokerWallet = walletOf(broker);
  const brokerState = await getBrokerState(loanBrokerID);
  const coverAvailable = brokerState?.coverAvailable ?? BigInt(vault.firstLoss ?? "0");
  const coverRequired = firstLossOf((brokerState?.debtTotal ?? 0n) + TICKET); // 70 % of every open loan incl. this one
  if (coverAvailable < coverRequired) {
    throw new AyzeError("AYZE_BROKER_COVER_INSUFFICIENT", `The vault's LoanBroker holds ${dropsToXrp(coverAvailable)} XRP of cover; ${dropsToXrp(coverRequired)} XRP are required (${dropsToXrp(cover)} per loan).`);
  }
  const borrowerWallet = walletOf(borrower);
  const fee = ayzeFeeOf(TICKET);
  const borrowerXRP = await getSpendableBalance(borrowerWallet.address);
  if (borrowerXRP < fee) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", `The AYZE fee is ${dropsToXrp(fee)} XRP; wallet can spend ${dropsToXrp(borrowerXRP)} (after reserve).`);

  // 1. LoanSet signed by the broker, counter-signed by the borrower
  const gracePeriod = defaultGrace(terms);
  const client = await getClient();
  const loanSet = await client.autofill({
    TransactionType: "LoanSet",
    Account: brokerWallet.address,
    Counterparty: borrowerWallet.address,
    LoanBrokerID: loanBrokerID,
    PrincipalRequested: toXRPL(TICKET), // drops: the vault asset is native XRP
    InterestRate: 0,
    PaymentTotal: terms.paymentTotal,
    PaymentInterval: terms.paymentInterval,
    GracePeriod: gracePeriod,
  } as LoanSet);
  const brokerSigned = decode(brokerWallet.sign(loanSet).tx_blob) as unknown as LoanSet;
  const fullySigned = signLoanSetByCounterparty(borrowerWallet, brokerSigned);
  const loanSetResult = await submitSigned(fullySigned.tx_blob);
  const loanID = createdIndex(loanSetResult.meta, "Loan");
  const node = await ledgerEntry(loanID);
  const startDate = Number(node?.StartDate ?? 0);

  const loan: Loan = {
    id: newId(),
    loanID,
    loanBrokerID,
    vaultID: vault.vaultID,
    brokerId: broker.id,
    borrowerId: borrower.id,
    principal: TICKET.toString(),
    paymentTotal: terms.paymentTotal,
    paymentInterval: terms.paymentInterval,
    gracePeriod,
    graceSeconds: gracePeriod,
    startDate,
    schedule: buildSchedule(TICKET, startDate, terms).map((i) => ({
      index: i.index,
      dueDate: i.dueDate,
      principal: i.principal.toString(),
      interest: i.interest.toString(),
    })),
    status: "active",
    txHashes: { loanSet: loanSetResult.hash },
    createdAt: new Date().toISOString(),
  };
  await updateRegistry((r) => r.loans.push(loan));

  // 2. AYZE origination fee (0.5 %). The loan is live whatever happens here: a failure is
  // recorded on the loan and the servicing loop retries until the Payment validates.
  try {
    loan.txHashes.ayzeFee = await collectAyzeFee(loan);
  } catch (error) {
    const reason = error instanceof AyzeError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
    console.warn(`[loans] AYZE fee deferred loan=${loan.id}: ${reason}`);
    await updateRegistry((r) => {
      const target = r.loans.find((l) => l.id === loan.id);
      if (target) target.ayzeFeeError = reason;
    });
  }
  return { loan, hashes: loan.txHashes };
}

/**
 * Sends the 0.5 % origination fee (borrower → AYZE) for a loan that does not have it yet and
 * returns the Payment hash. Idempotent: a loan whose `txHashes.ayzeFee` is set returns it as is.
 * Skips the submit when the borrower cannot cover the fee after reserve, so a retry loop never
 * burns transaction fees on tecUNFUNDED.
 */
export async function collectAyzeFee(loan: Loan): Promise<string> {
  if (loan.txHashes.ayzeFee) return loan.txHashes.ayzeFee;
  const borrower = findUser(loan.borrowerId);
  if (!borrower) throw new AyzeError("AYZE_NOT_FOUND", "Borrower not found.");
  const platform = await ensurePlatform();
  const wallet = walletOf(borrower);
  const fee = ayzeFeeOf(BigInt(loan.principal));
  const spendable = await getSpendableBalance(wallet.address);
  if (spendable < fee) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", `The AYZE fee is ${dropsToXrp(fee)} XRP; wallet can spend ${dropsToXrp(spendable)} (after reserve).`);
  const { hash } = await sendXRP(wallet, platform.ayze.address, fee);
  await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id);
    if (target) {
      target.txHashes.ayzeFee = hash;
      delete target.ayzeFeeError;
    }
  });
  return hash;
}

/* ------------------------------------------------------------------ */
/* Instalments                                                         */
/* ------------------------------------------------------------------ */

export type PaymentBreakdown = {
  index: number;
  principal: Drops;
  interest: Drops;
  toProtectionSeller: Drops;
  toBroker: Drops;
  toLenders: Array<{ lenderId: string; address: string; amount: Drops }>;
  hashes: string[];
};

/** Lenders of a vault weighted by their share balance. */
async function lenderWeights(vault: Vault, shareMPTID: string) {
  const registry = readRegistry();
  const lenders = registry.deposits
    .filter((d) => d.vaultID === vault.vaultID)
    .map((d) => registry.users.find((u) => u.id === d.lenderId))
    .filter((u): u is User => Boolean(u));
  const weights = await Promise.all(lenders.map((u) => getShareBalance(u.wallet.address, shareMPTID)));
  return lenders.map((u, i) => ({ user: u, weight: weights[i] })).filter((l) => l.weight > 0n);
}

/**
 * Pays the next instalment: LoanPay for the principal (what the ledger expects),
 * then the flat interest as Payments to the protection seller, the broker and
 * the lenders pro-rata of their shares.
 */
export async function payInstalment(borrower: User, loan: Loan): Promise<PaymentBreakdown> {
  if (loan.status !== "active") throw new AyzeError("AYZE_LOAN_CLOSED", "This loan is no longer active.");
  const state = await getLoanState(loan.loanID);
  if (!state || state.status === "repaid") throw new AyzeError("AYZE_LOAN_CLOSED", "Nothing left to pay.");
  if (state.status === "defaulted") throw new AyzeError("AYZE_LOAN_CLOSED", "The loan has been defaulted.");
  const instalment = loan.schedule.find((i) => !i.paidTxHash);
  if (!instalment) throw new AyzeError("AYZE_LOAN_CLOSED", "Every instalment is paid.");

  const vault = readRegistry().vaults.find((v) => v.vaultID === loan.vaultID);
  const broker = findUser(loan.brokerId);
  if (!vault || !broker) throw new AyzeError("AYZE_NOT_FOUND", "Vault or broker missing from the registry.");
  const wallet = walletOf(borrower);

  // Ledger amount: the last instalment settles whatever is outstanding.
  const principal = state.paymentRemaining <= 1 ? state.totalValueOutstanding : state.periodicPayment;
  const interest = BigInt(instalment.interest);
  const split = splitInterest(interest);
  const seller = loan.guarantee ? findUser(loan.guarantee.protectionSellerId) : null;
  // No protection seller: the broker carries the whole first loss and takes that share.
  const toBroker = seller ? split.broker : split.broker + split.protectionSeller;
  const toProtectionSeller = seller ? split.protectionSeller : 0n;

  const vaultState = await getVaultState(vault.vaultID);
  const lenders = vaultState ? await lenderWeights(vault, vaultState.shareMPTID) : [];
  const lenderAmounts = splitProRata(split.lender, lenders.map((l) => l.weight));
  const toLenders = lenders.map((l, i) => ({ lenderId: l.user.id, address: l.user.wallet.address, amount: lenderAmounts[i] }));
  const lenderTotal = toLenders.reduce((a, b) => a + b.amount, 0n);
  const toBrokerFinal = toBroker + (split.lender - lenderTotal); // no lender on record → broker

  const needed = principal + interest;
  const balance = await getSpendableBalance(wallet.address);
  if (balance < needed) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", `This instalment needs ${dropsToXrp(needed)} XRP; wallet can spend ${dropsToXrp(balance)} (after reserve).`);

  const hashes: string[] = [];
  const pay: LoanPay = {
    TransactionType: "LoanPay",
    Account: wallet.address,
    LoanID: loan.loanID,
    Amount: toXRPL(principal),
  };
  // Past NextPaymentDueDate the ledger demands tfLoanLatePayment (tecEXPIRED otherwise); before it,
  // the flag is refused (tecTOO_SOON). The auto-debit fires right at the due date, so try the
  // variant the ledger clock suggests and fall back once on the boundary codes.
  const late = state.nextPaymentDueDate !== null && state.now >= state.nextPaymentDueDate;
  const withFlag = (flag: boolean): LoanPay => (flag ? { ...pay, Flags: LoanPayFlags.tfLoanLatePayment } : pay);
  const paid = await submit(withFlag(late), wallet).catch((error: unknown) => {
    if (error instanceof AyzeError && (error.code === "XRPL_tecEXPIRED" || error.code === "XRPL_tecTOO_SOON")) return submit(withFlag(!late), wallet);
    throw error;
  });
  hashes.push(paid.hash);
  await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id)?.schedule.find((i) => i.index === instalment.index);
    if (target) target.paidTxHash = paid.hash;
  });

  if (seller && toProtectionSeller > 0n) hashes.push((await sendXRP(wallet, seller.wallet.address, toProtectionSeller)).hash);
  if (toBrokerFinal > 0n) hashes.push((await sendXRP(wallet, broker.wallet.address, toBrokerFinal)).hash);
  for (const lender of toLenders) {
    if (lender.amount > 0n) hashes.push((await sendXRP(wallet, lender.address, lender.amount)).hash);
  }

  const after = await getLoanState(loan.loanID);
  if (after?.status === "repaid") await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id);
    if (target) target.status = "repaid";
  });

  return { index: instalment.index, principal, interest, toProtectionSeller, toBroker: toBrokerFinal, toLenders, hashes };
}

/** Pays every remaining instalment in sequence (early full repayment). */
export async function repayInFull(borrower: User, loan: Loan): Promise<PaymentBreakdown[]> {
  const results: PaymentBreakdown[] = [];
  for (;;) {
    const fresh = readRegistry().loans.find((l) => l.id === loan.id);
    if (!fresh || fresh.status !== "active" || fresh.schedule.every((i) => i.paidTxHash)) break;
    results.push(await payInstalment(borrower, fresh));
  }
  if (results.length === 0) throw new AyzeError("AYZE_LOAN_CLOSED", "Nothing left to pay.");
  return results;
}

/* ------------------------------------------------------------------ */
/* Default and closing                                                 */
/* ------------------------------------------------------------------ */

export type DefaultResult = { hash: string; missedIndex: number; coverApplied: Drops; claim: { hashes: string[]; claimed: Drops } | null };

/**
 * Broker declares the default. Before `due + grace` the ledger answers tecTOO_SOON.
 * On success the cover moves to the vault and the insurance escrows are claimed.
 */
export async function declareDefault(broker: User, loan: Loan, by: "auto" | "broker" = "broker"): Promise<DefaultResult> {
  if (loan.status !== "active") throw new AyzeError("AYZE_LOAN_CLOSED", "This loan is no longer active.");
  const wallet = walletOf(broker);
  const before = await getLoanState(loan.loanID);
  const brokerBefore = await getBrokerState(loan.loanBrokerID);
  const missedIndex = before ? loan.paymentTotal - before.paymentRemaining + 1 : 1;
  const tx: LoanManage = {
    TransactionType: "LoanManage",
    Account: wallet.address,
    LoanID: loan.loanID,
    Flags: LoanManageFlags.tfLoanDefault,
  };
  const { hash } = await submit(tx, wallet);
  const brokerAfter = await getBrokerState(loan.loanBrokerID);
  const coverApplied = (brokerBefore?.coverAvailable ?? 0n) - (brokerAfter?.coverAvailable ?? 0n);
  const updated = await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id);
    if (!target) throw new AyzeError("AYZE_NOT_FOUND", "Loan not found.");
    target.status = "defaulted";
    target.missedIndex = missedIndex;
    target.defaultedBy = by;
    return structuredClone(target);
  });
  let claim: DefaultResult["claim"] = null;
  if (updated.guarantee) {
    try {
      claim = await claimInsurance(broker, updated);
    } catch (error) {
      if (!(error instanceof AyzeError)) throw error; // claim can be retried from the UI
    }
  }
  return { hash, missedIndex, coverApplied, claim };
}

/**
 * After repayment or default: delete the loan. The vault's LoanBroker (and its cover)
 * stays for the next loans; a legacy per-loan LoanBroker is drained and deleted.
 */
export async function closeLoan(broker: User, loan: Loan): Promise<string[]> {
  if (loan.status === "active") throw new AyzeError("AYZE_LOAN_CLOSED", "Close is possible once the loan is repaid or defaulted.");
  if (loan.status === "closed") throw new AyzeError("AYZE_LOAN_CLOSED", "Already closed.");
  const wallet = walletOf(broker);
  const hashes: string[] = [];
  if (await ledgerEntry(loan.loanID)) {
    const del: LoanDelete = { TransactionType: "LoanDelete", Account: wallet.address, LoanID: loan.loanID };
    hashes.push((await submit(del, wallet)).hash);
  }
  const vault = readRegistry().vaults.find((v) => v.vaultID === loan.vaultID);
  const shared = vault?.loanBrokerID === loan.loanBrokerID;
  const state = shared ? null : await getBrokerState(loan.loanBrokerID);
  if (state && state.coverAvailable > 0n) {
    const withdrawTx: LoanBrokerCoverWithdraw = {
      TransactionType: "LoanBrokerCoverWithdraw",
      Account: wallet.address,
      LoanBrokerID: loan.loanBrokerID,
      Amount: toXRPL(state.coverAvailable),
    };
    hashes.push((await submit(withdrawTx, wallet)).hash);
  }
  if (state) {
    const del: LoanBrokerDelete = { TransactionType: "LoanBrokerDelete", Account: wallet.address, LoanBrokerID: loan.loanBrokerID };
    hashes.push((await submit(del, wallet)).hash);
  }
  await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id);
    if (target) target.status = "closed";
  });
  return hashes;
}

export const ayzeAddress = async () => ayzeWallet(await ensurePlatform()).address;
