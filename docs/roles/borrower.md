# Roadmap — Borrower

The borrower finances their business: gets verified **per vault** (two XLS-70 credentials), draws
a fixed 1,000 XRP ticket, then instalments are **auto-debited** by the servicing loop (they can
also pay manually or repay in full).

**Account**: custodial (company, email, password) — the seed is in `registry.json`, which is what
makes automatic debit possible. **Home**: `/market`.

## Journey

```mermaid
flowchart TB
    classDef page fill:#f1f5f9,stroke:#334155,color:#111
    classDef act fill:#fef3c7,stroke:#b45309,color:#111
    classDef tx fill:#d1fae5,stroke:#047857,color:#111
    classDef auto fill:#e9d5ff,stroke:#6d28d9,color:#111

    A["/login › Create account<br/>role borrower"]:::page --> B["registerUser<br/>Wallet.generate · fundXRP 10,000"]:::act
    B --> C["/market — Marketplace<br/>vaults · « verified on x/y vaults »"]:::page
    C --> D["Be verified (per vault)"]:::act
    D --> D1["CredentialCreate AYZE_KYC (AYZE) + CredentialAccept<br/>CredentialCreate VAULT_id (broker) + CredentialAccept"]:::tx
    D1 --> C
    C --> E["Borrow<br/>paymentTotal 1–12 · paymentInterval ≥ 60 s"]:::act
    E --> E1["LoanSet counter-signed (broker + borrower)<br/>Payment 5 XRP → AYZE"]:::tx
    E1 --> F["/borrower — My loans<br/>status · next due · schedule"]:::page
    F -.-> G["Servicing 15 s<br/>auto-debit at each due date"]:::auto
    G --> G1["LoanPay principal_i<br/>+ Payment interest PS / broker / lenders"]:::tx
    F --> H["Pay instalment (manual)"]:::act --> G1
    F --> I["Repay in full"]:::act --> I1["payInstalment × remaining instalments"]:::tx
    G1 & I1 -->|all paid| J["status repaid<br/>(the ledger deletes the Loan)"]
    G -->|"unpaid after due + grace"| K["Auto-default by the broker<br/>LoanManage tfLoanDefault"]:::auto
```

## What they see

| Page | Content | Source |
|---|---|---|
| `/market` | Wallet XRP + « verified on x/y vaults »; per vault: available, loans, **Be verified** button or **Borrow** form (when verified and ≥ 1,000 XRP available) | `views.ts › listVaults`, `credentials.ts › hasVaultAccess` |
| `/borrower` | Wallet; **My loans**: `LoanCard` (vault, broker, ledger status, next due, schedule with `paid / upcoming / due / late / defaulted`, last auto-debit error), Pay instalment / Repay in full buttons | `views.ts › loanView`, `ledger.ts › getLoanState` |

## What they can do

| UI action | Server Action | Protocol function | Transactions | Typical errors |
|---|---|---|---|---|
| Be verified | `beVerifiedAction` | `credentials.ts › verifyBorrowerForVault` | `CredentialCreate` ×2 + `CredentialAccept` ×2 | `AYZE_FORBIDDEN_ROLE`, `AYZE_NOT_FOUND` |
| Borrow | `borrowAction` | `loans.ts › borrow` | `LoanSet` (co-signed), `Payment` 0.5 % | `AYZE_INVALID_TERMS`, `AYZE_KYC_REQUIRED`, `AYZE_INSUFFICIENT_LIQUIDITY`, `AYZE_BROKER_COVER_INSUFFICIENT`, `AYZE_INSUFFICIENT_FUNDS` |
| Pay instalment | `payInstalmentAction` | `loans.ts › payInstalment` | `LoanPay` (+ `tfLoanLatePayment` when late), `Payment` × (PS, broker, lenders) | `AYZE_INSUFFICIENT_FUNDS`, `AYZE_LOAN_CLOSED` |
| Repay in full | `repayInFullAction` | `loans.ts › repayInFull` | same, for every remaining instalment | same |

## Loan terms

| Parameter | Value | Source |
|---|---|---|
| Principal | fixed 1,000 XRP (`TICKET`) | `economics.ts` |
| Instalments `paymentTotal` | 1 to 12 | `TERMS`, XLS-66 bound `PaymentTotal ≥ 1` |
| Interval `paymentInterval` | ≥ 60 s | XLS-66 bound |
| `GracePeriod` | `ceil(10 % × N × interval)` clamped to [60 s, interval] | `economics.ts › defaultGrace` |
| Interest | 6 % flat, split into N equal parts, paid by `Payment` | `buildSchedule`, `splitInterest` |
| AYZE fee | 5 XRP at origination | `ayzeFeeOf` |

The schedule (`schedule[]`) is computed once at origination from the ledger Loan's `StartDate`
and drives both the PS escrows and the payments.
