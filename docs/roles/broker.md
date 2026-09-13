# Roadmap — Broker

The broker structures deals: opens vaults, posts first-loss capital, issues the access credential
for their vault, declares defaults and claims the insurance.

**Account**: custodial (company, email, scrypt password) — the wallet seed is in `registry.json`.
**Home**: `/broker`.

## Journey

```mermaid
flowchart TB
    classDef page fill:#f1f5f9,stroke:#334155,color:#111
    classDef act fill:#fef3c7,stroke:#b45309,color:#111
    classDef tx fill:#d1fae5,stroke:#047857,color:#111

    A["/login › Create account<br/>role broker"]:::page --> B["registerUser<br/>Wallet.generate · fundXRP 10,000"]:::act
    B --> C["/broker — My vaults<br/>Wallet · vault list"]:::page
    C --> D["Create a vault<br/>name · description · first-loss XRP"]:::act
    D --> D1["VaultCreate → LoanBrokerSet → LoanBrokerCoverDeposit"]:::tx
    D1 --> C
    C --> E["/broker/vaults/[id]<br/>liquidity · cover · loans · verified borrowers"]:::page
    E -->|"borrower clicks Be verified"| F["CredentialCreate VAULT_id<br/>(signed by the broker, triggered by the borrower)"]:::tx
    E -->|late loan| G["Declare default"]:::act
    G --> G1["LoanManage tfLoanDefault<br/>tecTOO_SOON before due + grace"]:::tx
    G1 --> H["Claim insurance"]:::act
    H --> H1["EscrowFinish × LOCKED escrows<br/>index ≥ missedIndex"]:::tx
    E -->|loan repaid or defaulted| I["Close"]:::act
    I --> I1["LoanDelete<br/>(+ LoanBrokerCoverWithdraw + LoanBrokerDelete<br/>for a legacy per-loan LoanBroker)"]:::tx
```

## What they see

| Page | Content | Source |
|---|---|---|
| `/broker` | Wallet XRP; per vault: liquidity available/total, cover available/posted, active loans, defaulted; *Create a vault* form | `views.ts › listVaults(v => v.brokerId === me)` |
| `/broker/vaults/[id]` | Vault / LoanBroker addresses, XRP activity of the broker and of the vault pseudo-account, stats, *Verified borrowers*, loan list with actions | `views.ts › loanView`, `ledger.ts › getAccountActivity` |

## What they can do

| UI action | Server Action | Protocol function | Transactions | Typical errors |
|---|---|---|---|---|
| Create a vault | `createVaultAction` | `vaults.ts › createVault` | `VaultCreate`, `LoanBrokerSet`, `LoanBrokerCoverDeposit` | `AYZE_BROKER_COVER_INSUFFICIENT`, `AYZE_INVALID_INPUT` |
| Declare default | `declareDefaultAction` | `loans.ts › declareDefault` (+ `claimInsurance`) | `LoanManage tfLoanDefault`, then `EscrowFinish` × n | `XRPL_tecTOO_SOON` (guardrail), `AYZE_LOAN_CLOSED` |
| Claim insurance | `claimInsuranceAction` | `guarantees.ts › claimInsurance` | `EscrowFinish` × n | `AYZE_LOAN_NOT_DEFAULTED`, `AYZE_NOT_FOUND` (already claimed / expired) |
| Close | `closeLoanAction` | `loans.ts › closeLoan` | `LoanDelete` (+ `LoanBrokerCoverWithdraw`, `LoanBrokerDelete`) | `AYZE_LOAN_CLOSED` |

The broker also signs, without clicking: the `LoanSet` of every borrow (co-signature with the
borrower, `loans.ts › borrow`) and the `CredentialCreate VAULT_<id>`
(`credentials.ts › verifyBorrowerForVault`). The servicing loop declares defaults on their behalf
(`defaultedBy: "auto"`).

## What they earn / risk

- **Earn**: 30 % of each instalment's interest (50 % + 30 % when the loan has no PS), received as a
  direct `Payment` from the borrower. Escrows claimed after a default (40 % of the remaining
  principal).
- **Risk**: 70 % of the remaining debt on default, taken from `CoverAvailable` by the ledger
  (`CoverRateMinimum 70 % × CoverRateLiquidation 100 %`). Net after insurance: −30 %.
- **Constraint**: the cover must be ≥ 70 % of (`DebtTotal` + 1,000) for each new borrow to go
  through (`AYZE_BROKER_COVER_INSUFFICIENT`).
