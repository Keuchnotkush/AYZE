import "server-only";
import {
  decode,
  signLoanSetByCounterparty,
  LoanManageFlags,
  type LoanBrokerCoverDeposit,
  type LoanBrokerCoverWithdraw,
  type LoanBrokerDelete,
  type LoanBrokerSet,
  type LoanDelete,
  type LoanManage,
  type LoanPay,
  type LoanSet,
} from "xrpl";
import { assertKyc, walletOf } from "./accounts";
import { splitProRata, toXRPL, type Micro } from "./amounts";
import {
  ayzeFeeOf,
  buildSchedule,
  COVER_RATE_LIQUIDATION,
  COVER_RATE_MINIMUM,
  firstLossOf,
  splitInterest,
  TICKET,
  validateTerms,
  type Terms,
} from "./economics";
import { AyzeError } from "./errors";
import { createdIndex, getBrokerState, getLoanState, getShareBalance, getUSDBalance, getVaultState, ledgerEntry } from "./ledger";
import { ayzeWallet, ensurePlatform, sendUSD, usdAsset } from "./platform";
import { claimInsurance } from "./guarantees";
import { findUser, newId, readRegistry, updateRegistry, type Loan, type User, type Vault } from "./registry";
import { getClient, submit, submitSigned } from "./xrpl";

/* XLS-66 loans. One LoanBroker per loan so that the ledger's default formula
   (DebtTotal × CoverRateMinimum × CoverRateLiquidation) is exactly 70 % of this loan. */

export type BorrowResult = { loan: Loan; hashes: Loan["txHashes"] };

export async function borrow(borrower: User, vault: Vault, terms: Terms): Promise<BorrowResult> {
  const invalid = validateTerms(terms);
  if (invalid) throw new AyzeError("AYZE_INVALID_TERMS", invalid);
  await assertKyc(borrower);

  const platform = await ensurePlatform();
  const broker = findUser(vault.brokerId);
  if (!broker) throw new AyzeError("AYZE_NOT_FOUND", "Broker not found.");
  const state = await getVaultState(vault.vaultID);
  if (!state) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found on the ledger.");
  if (state.assetsAvailable < TICKET) {
    throw new AyzeError("AYZE_INSUFFICIENT_LIQUIDITY", `Vault has ${toXRPL(state.assetsAvailable)} USD available; the ticket is ${toXRPL(TICKET)}.`);
  }
  const cover = firstLossOf(TICKET);
  const brokerWallet = walletOf(broker);
  const brokerUSD = await getUSDBalance(brokerWallet.address, platform.issuer.address);
  if (brokerUSD < cover) {
    throw new AyzeError("AYZE_BROKER_COVER_INSUFFICIENT", `Broker must post ${toXRPL(cover)} USD of first-loss cover but holds ${toXRPL(brokerUSD)}.`);
  }
  const borrowerWallet = walletOf(borrower);
  const fee = ayzeFeeOf(TICKET);
  const borrowerUSD = await getUSDBalance(borrowerWallet.address, platform.issuer.address);
  if (borrowerUSD < fee) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", `The AYZE fee is ${toXRPL(fee)} USD; wallet holds ${toXRPL(borrowerUSD)}.`);

  // 1. LoanBroker dedicated to this loan
  const brokerSet: LoanBrokerSet = {
    TransactionType: "LoanBrokerSet",
    Account: brokerWallet.address,
    VaultID: vault.vaultID,
    ManagementFeeRate: 0,
    DebtMaximum: "0",
    CoverRateMinimum: COVER_RATE_MINIMUM,
    CoverRateLiquidation: COVER_RATE_LIQUIDATION,
  };
  const set = await submit(brokerSet, brokerWallet);
  const loanBrokerID = createdIndex(set.meta, "LoanBroker");

  // 2. First-loss cover
  const coverTx: LoanBrokerCoverDeposit = {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: brokerWallet.address,
    LoanBrokerID: loanBrokerID,
    Amount: { ...usdAsset(platform), value: toXRPL(cover) },
  };
  const coverDeposit = await submit(coverTx, brokerWallet);

  // 3. LoanSet signed by the broker, counter-signed by the borrower
  const client = await getClient();
  const loanSet = await client.autofill({
    TransactionType: "LoanSet",
    Account: brokerWallet.address,
    Counterparty: borrowerWallet.address,
    LoanBrokerID: loanBrokerID,
    PrincipalRequested: toXRPL(TICKET),
    InterestRate: 0,
    PaymentTotal: terms.paymentTotal,
    PaymentInterval: terms.paymentInterval,
    GracePeriod: terms.gracePeriod,
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
    gracePeriod: terms.gracePeriod,
    startDate,
    schedule: buildSchedule(TICKET, startDate, terms).map((i) => ({
      index: i.index,
      dueDate: i.dueDate,
      principal: i.principal.toString(),
      interest: i.interest.toString(),
    })),
    status: "active",
    txHashes: { loanBrokerSet: set.hash, coverDeposit: coverDeposit.hash, loanSet: loanSetResult.hash },
    createdAt: new Date().toISOString(),
  };
  await updateRegistry((r) => r.loans.push(loan));

  // 4. AYZE origination fee (0.5 %) — recorded even if it fails after the loan exists.
  const feeTx = await sendUSD(borrowerWallet, platform.ayze.address, toXRPL(fee), platform.issuer.address);
  loan.txHashes.ayzeFee = feeTx.hash;
  await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id);
    if (target) target.txHashes.ayzeFee = feeTx.hash;
  });
  return { loan, hashes: loan.txHashes };
}

/* ------------------------------------------------------------------ */
/* Instalments                                                         */
/* ------------------------------------------------------------------ */

export type PaymentBreakdown = {
  index: number;
  principal: Micro;
  interest: Micro;
  toProtectionSeller: Micro;
  toBroker: Micro;
  toLenders: Array<{ lenderId: string; address: string; amount: Micro }>;
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
  const platform = await ensurePlatform();
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
  const balance = await getUSDBalance(wallet.address, platform.issuer.address);
  if (balance < needed) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", `This instalment needs ${toXRPL(needed)} USD; wallet holds ${toXRPL(balance)}.`);

  const hashes: string[] = [];
  const pay: LoanPay = {
    TransactionType: "LoanPay",
    Account: wallet.address,
    LoanID: loan.loanID,
    Amount: { ...usdAsset(platform), value: toXRPL(principal) },
  };
  const paid = await submit(pay, wallet);
  hashes.push(paid.hash);
  await updateRegistry((r) => {
    const target = r.loans.find((l) => l.id === loan.id)?.schedule.find((i) => i.index === instalment.index);
    if (target) target.paidTxHash = paid.hash;
  });

  if (seller && toProtectionSeller > 0n) hashes.push((await sendUSD(wallet, seller.wallet.address, toXRPL(toProtectionSeller), platform.issuer.address)).hash);
  if (toBrokerFinal > 0n) hashes.push((await sendUSD(wallet, broker.wallet.address, toXRPL(toBrokerFinal), platform.issuer.address)).hash);
  for (const lender of toLenders) {
    if (lender.amount > 0n) hashes.push((await sendUSD(wallet, lender.address, toXRPL(lender.amount), platform.issuer.address)).hash);
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

export type DefaultResult = { hash: string; missedIndex: number; coverApplied: Micro; claim: { hashes: string[]; claimed: Micro } | null };

/**
 * Broker declares the default. Before `due + grace` the ledger answers tecTOO_SOON.
 * On success the cover moves to the vault and the insurance escrows are claimed.
 */
export async function declareDefault(broker: User, loan: Loan): Promise<DefaultResult> {
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

/** After repayment or default: delete the loan, recover the cover, delete the broker object. */
export async function closeLoan(broker: User, loan: Loan): Promise<string[]> {
  if (loan.status === "active") throw new AyzeError("AYZE_LOAN_CLOSED", "Close is possible once the loan is repaid or defaulted.");
  if (loan.status === "closed") throw new AyzeError("AYZE_LOAN_CLOSED", "Already closed.");
  const platform = await ensurePlatform();
  const wallet = walletOf(broker);
  const hashes: string[] = [];
  if (await ledgerEntry(loan.loanID)) {
    const del: LoanDelete = { TransactionType: "LoanDelete", Account: wallet.address, LoanID: loan.loanID };
    hashes.push((await submit(del, wallet)).hash);
  }
  const state = await getBrokerState(loan.loanBrokerID);
  if (state && state.coverAvailable > 0n) {
    const withdrawTx: LoanBrokerCoverWithdraw = {
      TransactionType: "LoanBrokerCoverWithdraw",
      Account: wallet.address,
      LoanBrokerID: loan.loanBrokerID,
      Amount: { ...usdAsset(platform), value: toXRPL(state.coverAvailable) },
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
