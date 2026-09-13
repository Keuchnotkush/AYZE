# AYZE — overview

AYZE is a **marketplace of lending vaults on the XRP Ledger**. A broker opens a vault and posts
first-loss capital; lenders fund it; borrowers draw fixed 1,000 XRP tickets; protection sellers
guarantee each loan with conditional escrows. Everything settles in **native XRP**.

## 1. The five actors

```mermaid
flowchart LR
    classDef custodial fill:#fde68a,stroke:#b45309,color:#111
    classDef walletOnly fill:#bfdbfe,stroke:#1d4ed8,color:#111
    classDef platform fill:#e9d5ff,stroke:#6d28d9,color:#111
    classDef ledger fill:#d1fae5,stroke:#047857,color:#111

    Broker["Broker<br/>custodial (email + password)"]:::custodial
    Borrower["Borrower<br/>custodial (email + password)"]:::custodial
    Lender["Lender<br/>wallet-only (seed)"]:::walletOnly
    PS["Protection seller<br/>wallet-only (seed)"]:::walletOnly
    AYZE["AYZE platform<br/>platform.json"]:::platform

    Vault["Vault XLS-65<br/>+ LoanBroker XLS-66"]:::ledger
    Loan["Loan XLS-66"]:::ledger
    Escrows["Conditional escrows"]:::ledger
    Creds["Credentials XLS-70"]:::ledger

    Broker -- "VaultCreate · LoanBrokerSet<br/>LoanBrokerCoverDeposit" --> Vault
    Lender -- "VaultDeposit / VaultWithdraw" --> Vault
    Borrower -- "LoanSet (counter-signed)<br/>LoanPay" --> Loan
    Vault -- "funds" --> Loan
    PS -- "EscrowCreate × instalments" --> Escrows
    Escrows -- "EscrowFinish after default" --> Broker
    AYZE -- "CredentialCreate AYZE_KYC" --> Creds
    Broker -- "CredentialCreate VAULT_id" --> Creds
    Creds -- "required for LoanSet" --> Borrower
    Borrower -- "Payment 0.5 %" --> AYZE
    AYZE -- "EscrowCancel (release)" --> Escrows
```

| Actor | Wallet | Where the seed lives | File |
|---|---|---|---|
| Broker | custodial | `registry.json` (`users[].wallet.seed`) | `accounts.ts › registerUser` |
| Borrower | custodial | `registry.json` | `accounts.ts › registerUser` |
| Lender | wallet-only | AES-256-GCM session cookie only | `accounts.ts › connectWalletAccount / generateWalletAccount` |
| Protection seller | wallet-only | AES-256-GCM session cookie only | same |
| AYZE | platform | `data/platform.json` | `platform.ts › ensurePlatform` |

## 2. Layers

```mermaid
flowchart TB
    classDef ui fill:#f1f5f9,stroke:#334155,color:#111
    classDef srv fill:#fef3c7,stroke:#b45309,color:#111
    classDef proto fill:#dbeafe,stroke:#1e40af,color:#111
    classDef data fill:#dcfce7,stroke:#166534,color:#111

    subgraph UI["Next.js App Router — frontend/src/app"]
        direction LR
        Login["/login<br/>Create account · Log in · Connect wallet"]:::ui
        BrokerP["/broker<br/>/broker/vaults/[id]"]:::ui
        Market["/market"]:::ui
        BorrowerP["/borrower"]:::ui
        Protect["/protect"]:::ui
    end

    subgraph Actions["Server Actions — server/actions.ts"]
        Act["register · login · connectWallet · createVault · deposit · withdraw<br/>beVerified · borrow · payInstalment · repayInFull<br/>guarantee · declareDefault · claimInsurance · closeLoan"]:::srv
        Auth["auth/session.ts<br/>requireRole · pageRole · currentUser"]:::srv
    end

    subgraph Protocol["Protocol modules — frontend/src/server"]
        direction LR
        Vaults["vaults.ts<br/>XLS-65"]:::proto
        Loans["loans.ts<br/>XLS-66"]:::proto
        Creds["credentials.ts<br/>XLS-70"]:::proto
        Guar["guarantees.ts<br/>Escrow"]:::proto
        Serv["servicing.ts<br/>15 s loop"]:::proto
        Eco["economics.ts · amounts.ts<br/>bps, bigint drops"]:::proto
        Ledger["ledger.ts<br/>validated reads"]:::proto
        Xrpl["xrpl.ts<br/>submit · submitSigned"]:::proto
    end

    subgraph Data["State"]
        Registry["data/registry.json<br/>users · vaults · deposits · loans"]:::data
        Platform["data/platform.json<br/>AYZE wallet"]:::data
        XRPL["XRP Ledger devnet<br/>source of truth for amounts"]:::data
    end

    UI --> Act
    Act --> Auth
    Act --> Protocol
    Vaults & Loans & Creds & Guar & Serv --> Xrpl --> XRPL
    Ledger --> XRPL
    Vaults & Loans & Creds & Guar & Serv --> Registry
    Creds & Loans & Serv --> Platform
```

Golden rule: **the ledger is the source of truth for every amount** (vault, cover, loan, escrows,
balances). The registry only holds the *matching* (who owns / deposited / guaranteed what) and the
server-side secrets (custodial seeds, escrow fulfillments).

## 3. Objects created on the ledger

```mermaid
flowchart LR
    classDef obj fill:#d1fae5,stroke:#047857,color:#111
    Vault["Vault<br/>Asset XRP · AssetsAvailable<br/>ShareMPTID"]:::obj
    MPT["MPTokenIssuance<br/>vault shares (XLS-33)"]:::obj
    LB["LoanBroker<br/>CoverAvailable · DebtTotal<br/>CoverRateMinimum 70 %<br/>CoverRateLiquidation 100 %"]:::obj
    Loan["Loan<br/>PrincipalOutstanding · PaymentRemaining<br/>NextPaymentDueDate · GracePeriod<br/>lsfLoanDefault"]:::obj
    Cred1["Credential<br/>issuer AYZE · type AYZE_KYC"]:::obj
    Cred2["Credential<br/>issuer broker · type VAULT_id"]:::obj
    Esc["Escrow × N<br/>Condition · CancelAfter<br/>PS → broker"]:::obj

    Vault --> MPT
    Vault --> LB --> Loan
    Cred1 & Cred2 -.->|prerequisite| Loan
    Loan -.->|1 per remaining instalment| Esc
```

## 4. Application registry (model)

```mermaid
erDiagram
    USER {
        string id PK
        string role "broker | lender | borrower | protection-seller"
        string email "custodial only"
        string passwordHash "scrypt, custodial only"
        string wallet_address
        string wallet_seed "custodial only"
        json credentials "AYZE_KYC, VAULT_id"
    }
    VAULT {
        string id PK
        string vaultID "ledger index"
        string shareMPTID
        string loanBrokerID
        string brokerId FK
        string firstLoss "drops"
        json verifiedBorrowers
    }
    DEPOSIT {
        string vaultID FK
        string lenderId FK
    }
    LOAN {
        string id PK
        string loanID "ledger index"
        string loanBrokerID
        string vaultID FK
        string brokerId FK
        string borrowerId FK
        string principal "drops"
        int paymentTotal
        int paymentInterval
        int gracePeriod
        json schedule "index, dueDate, principal, interest, paidTxHash"
        string status "active | repaid | defaulted | closed"
        int missedIndex
        string defaultedBy "auto | broker"
    }
    GUARANTEE {
        string protectionSellerId FK
        json escrows "EscrowRecord[]"
    }
    ESCROW {
        int index
        string escrowID
        int offerSequence
        string amount "drops"
        string condition
        string fulfillment "server secret"
        int cancelAfter
        string status "LOCKED | CLAIMED | RELEASED | EXPIRED"
    }

    USER ||--o{ VAULT : "broker owns"
    USER ||--o{ DEPOSIT : "lender"
    VAULT ||--o{ DEPOSIT : ""
    VAULT ||--o{ LOAN : "drawn from"
    USER ||--o{ LOAN : "borrower"
    LOAN ||--o| GUARANTEE : "0..1"
    USER ||--o{ GUARANTEE : "protection seller"
    GUARANTEE ||--|{ ESCROW : "1 per instalment"
```

File: `frontend/src/server/registry.ts` (`readRegistry`, `updateRegistry` — atomic write by
rename, writers serialised through a promise chain).

## 5. Economics (integer bps)

Source: `frontend/src/server/economics.ts`. Every amount is in **`bigint` drops** (`amounts.ts`),
never a float.

| Constant | Value | Purpose |
|---|---|---|
| `TICKET` | 1,000 XRP | fixed loan size |
| `INTEREST_BPS` | 600 (6 %) | flat interest over the loan life, paid off-chain by `Payment` |
| `INTEREST_SPLIT_BPS` | PS 5,000 · broker 3,000 · lender 2,000 | split of each instalment's interest |
| `AYZE_FEE_BPS` | 50 (0.5 %) | AYZE origination fee |
| `FIRST_LOSS_BPS` | 7,000 (70 %) | broker cover required per open loan |
| `PROTECTION_BPS` | 4,000 (40 %) | PS escrows, per remaining instalment |
| `COVER_RATE_MINIMUM` | 70,000 (1/10 bps) | `LoanBrokerSet` parameter |
| `COVER_RATE_LIQUIDATION` | 100,000 | `LoanBrokerSet` parameter → the cover absorbs exactly 70 % of the remaining debt |
| `DEFAULT_GRACE_BPS` | 1,000 (10 % of duration) | `GracePeriod`, clamped to [60 s, interval] |
| `CLAIM_WINDOW` | 300 s | window after `due + grace` for `EscrowFinish` |
| `TERMS` | 1–12 instalments, interval ≥ 60 s | XLS-66 bounds |

```mermaid
pie showData title One instalment's interest (6 % of principal, split)
    "Protection seller 50 %" : 50
    "Broker 30 %" : 30
    "Lenders 20 % (pro rata of shares)" : 20
```

**Default at instalment k** (remaining principal R): the ledger moves `min(0.7 R, R, cover)` = 0.7 R
from the cover to the vault; the broker claims escrows k..N = 0.4 R. Net: broker −0.3 R,
PS −0.4 R, lenders −0.3 R.

## 6. Error codes

Source: `frontend/src/server/errors.ts`. Errors are **data**
(`ActionResult { ok:false, code, message, hashes }`), never exceptions thrown at the UI.

| Code | Raised by | When |
|---|---|---|
| `AYZE_UNAUTHENTICATED` | `session.ts › requireRole` | no session cookie |
| `AYZE_FORBIDDEN_ROLE` | `session.ts › requireRole` | action outside the role |
| `AYZE_KYC_REQUIRED` | `credentials.ts › assertVaultAccess` | borrow without both credentials accepted on-chain |
| `AYZE_INSUFFICIENT_LIQUIDITY` | `loans.ts › borrow` | `AssetsAvailable` < 1,000 XRP |
| `AYZE_BROKER_COVER_INSUFFICIENT` | `vaults.ts › createVault`, `loans.ts › borrow` | first-loss too small / `CoverAvailable` < 70 % of (`DebtTotal` + ticket) |
| `AYZE_INSUFFICIENT_FUNDS` | `vaults.ts`, `loans.ts`, `guarantees.ts` | spendable balance (balance − reserve) too low |
| `AYZE_ALREADY_GUARANTEED` | `guarantees.ts › guaranteeLoan` | loan already guaranteed |
| `AYZE_LOAN_NOT_DEFAULTED` | `guarantees.ts › claimInsurance` | claim on a non-defaulted loan |
| `AYZE_LOAN_CLOSED` | `loans.ts` | action on a loan that is no longer active |
| `AYZE_INVALID_TERMS` | `economics.ts › validateTerms` | instalments / interval out of bounds |
| `AYZE_INVALID_INPUT` | `actions.ts` | invalid form field |
| `AYZE_NOT_FOUND` | everywhere | object missing from registry / ledger |
| `AYZE_EMAIL_TAKEN`, `AYZE_BAD_CREDENTIALS` | `accounts.ts`, `actions.ts › login` | sign-up / sign-in |
| `XRPL_<tec…>` | `xrpl.ts › submit` | ledger rejection passed through (`XRPL_tecTOO_SOON`, `XRPL_tecEXPIRED`…) |
