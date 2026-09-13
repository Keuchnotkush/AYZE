# XLS-66 — Lending Protocol

One `LoanBroker` per vault, created and funded with first-loss cover when the broker opens the vault;
every `Loan` of that vault is drawn through it. Files: `frontend/src/server/vaults.ts` (broker
creation), `loans.ts`, `servicing.ts`, `economics.ts`, `ledger.ts`.

## Transactions

### `LoanBrokerSet` — `vaults.ts › createVault` (step 2/3)

Signer: broker (vault owner).

| Field | Value | Why |
|---|---|---|
| `VaultID` | the vault just created | |
| `ManagementFeeRate` | `0` | capped at 10 % of interest by the spec, so the 50/30/20 split is done with `Payment`s |
| `DebtMaximum` | `"0"` | unlimited; cover is checked per loan by the app |
| `CoverRateMinimum` | `70_000` (1/10 bps → 70 %) | first-loss = 70 % of open debt |
| `CoverRateLiquidation` | `100_000` (100 %) | on default the cover absorbs exactly 70 % of the remaining debt |

`createdIndex(meta, "LoanBroker")` → `Vault.loanBrokerID`.

### `LoanBrokerCoverDeposit` — `vaults.ts › createVault` (step 3/3)

Signer: broker. `Amount` = the first-loss capital typed in the form (drops). The registry keeps
`Vault.firstLoss` as a fallback when the ledger read fails; `CoverAvailable` on the ledger is the truth.

### `LoanSet` — `loans.ts › borrow`

The only two-party transaction. Sequence:

1. `client.autofill(loanSet)` with `Account` = broker, `Counterparty` = borrower.
2. `brokerWallet.sign(...)` → `decode(tx_blob)` to get the signed JSON back.
3. `signLoanSetByCounterparty(borrowerWallet, brokerSigned)` adds the `CounterpartySignature`.
4. `xrpl.ts › submitSigned(tx_blob)` (`submitAndWait` on the blob, no autofill).

| Field | Value |
|---|---|
| `LoanBrokerID` | the vault's |
| `PrincipalRequested` | `TICKET` = 1 000 XRP in drops |
| `InterestRate` | `0` — annualised and ≤ 100 %/yr, so ≈ 0 on a minutes-long demo loan; the flat 6 % is paid off-ledger (see `LoanPay`) |
| `PaymentTotal` | 1..12 (`economics.ts › TERMS`) |
| `PaymentInterval` | ≥ 60 s |
| `GracePeriod` | `economics.ts › defaultGrace` = ceil(10 % × duration) clamped to `[60 s, PaymentInterval]` |

After validation `createdIndex(meta, "Loan")` → `Loan.loanID`; `ledgerEntry(loanID).StartDate` seeds
`economics.ts › buildSchedule` (due dates, per-instalment principal and interest, all in drops).

Application pre-checks, in order: role → XLS-70 credentials (`AYZE_KYC_REQUIRED`) → `AssetsAvailable ≥
TICKET` (`AYZE_INSUFFICIENT_LIQUIDITY`) → `CoverAvailable ≥ 70 % × (DebtTotal + TICKET)`
(`AYZE_BROKER_COVER_INSUFFICIENT`) → borrower can pay the 0.5 % fee (`AYZE_INSUFFICIENT_FUNDS`).

### `LoanPay` — `loans.ts › payInstalment`

Signer: borrower. Triggered every 15 s by `servicing.ts › debit` when an instalment is due, or manually
(`payInstalmentAction`, `repayInFullAction`).

- `Amount` = `PeriodicPayment` from the ledger, or `TotalValueOutstanding` on the last instalment.
- Past `NextPaymentDueDate` the ledger requires `tfLoanLatePayment` (else `tecEXPIRED`); before it,
  the flag is refused (`tecTOO_SOON`). The auto-debit fires right at the boundary, so the function
  picks the variant the ledger clock suggests and retries once with the other flag on those two codes.
- The interest (`schedule[i].interest`) is then paid as native `Payment`s: 50 % protection seller
  (or broker if the loan has none), 30 % broker, 20 % lenders pro-rata of `MPTAmount`
  (`economics.ts › splitInterest`, `amounts.ts › splitProRata`).
- When `getLoanState` reports `repaid` afterwards, the registry status follows.

### `LoanManage` `tfLoanDefault` — `loans.ts › declareDefault`

Signer: broker. Triggered by `servicing.ts › autoDefault` once `now > due + grace`, or manually. Before
`due + GracePeriod` the ledger answers `tecTOO_SOON` (shown as `XRPL_tecTOO_SOON`). On success the
cover moves to the vault (`coverApplied` = `CoverAvailable` before − after) and `guarantees.ts ›
claimInsurance` finishes the escrows.

### `LoanDelete`, `LoanBrokerCoverWithdraw`, `LoanBrokerDelete` — `loans.ts › closeLoan`

Signer: broker. `LoanDelete` once the loan is repaid or defaulted (skipped if the ledger already
removed it). The vault's LoanBroker and its cover stay for the next loans; `LoanBrokerCoverWithdraw` +
`LoanBrokerDelete` only run for a legacy per-loan LoanBroker (`loan.loanBrokerID ≠ vault.loanBrokerID`).

## Reads

| Function | Object | Fields used |
|---|---|---|
| `ledger.ts › getBrokerState` | `LoanBroker` | `DebtTotal`, `CoverAvailable`, `Owner`, `Account` |
| `ledger.ts › getLoanState` | `Loan` | `PaymentRemaining`, `NextPaymentDueDate`, `GracePeriod`, `TotalValueOutstanding`, `PrincipalOutstanding`, `PeriodicPayment`, `StartDate`, `Flags` (`lsfLoanDefault` = `0x00010000`) |

`getLoanState` derives a status from those fields and the ledger clock: `current` → `late` (past due)
→ `defaultable` (past due + grace) → `defaulted` (flag) / `repaid` (`PaymentRemaining` 0 or
`TotalValueOutstanding` 0) / `deleted` (entry gone).

## Spec constraints that shaped the design

| Constraint | Consequence |
|---|---|
| `ManagementFeeRate` ≤ 10 % of interest | interest split is done with `Payment`s |
| `InterestRate` annualised | `InterestRate: 0`, flat 6 % handled by the app |
| `DefaultCovered = min(DebtTotal × CoverRateMinimum × CoverRateLiquidation, DefaultAmount, CoverAvailable)` on the **LoanBroker**'s `DebtTotal` | one LoanBroker per vault, app enforces 700 XRP of cover per open loan |
| `PaymentInterval ≥ 60 s`, `GracePeriod ∈ [60 s, PaymentInterval]` | bounds of the borrow form; 10 %-of-duration grace is clamped on short loans |
| `LoanSet` needs both signatures | `signLoanSetByCounterparty` + `submitSigned` |

## Not used

`LoanBrokerCoverClawback`, `LoanManage` `tfLoanImpair` / `tfLoanUnimpair`, `LoanSet` in update mode,
`LateInterestRate` / `CloseInterestRate` / origination and service fees (all 0).
