# General roadmap — from registration to loan close

This document follows one loan end to end: who does what, in which order, which transaction hits
the ledger and which function signs it. Files are in `frontend/src/server/`.

## 0. Big picture

```mermaid
flowchart LR
    classDef step fill:#f8fafc,stroke:#334155,color:#111
    classDef auto fill:#fef3c7,stroke:#b45309,color:#111

    A["1 · Registration<br/>4 roles"]:::step --> B["2 · Broker creates a vault<br/>+ first-loss"]:::step
    B --> C["3 · Lender deposits"]:::step
    C --> D["4 · Borrower verified<br/>2 credentials"]:::step
    D --> E["5 · Borrower borrows<br/>1,000 XRP"]:::step
    E --> F["6 · PS guarantees<br/>escrows × N"]:::step
    F --> G["7 · Servicing<br/>auto-debit every 15 s"]:::auto
    G -->|all paid| H["8a · Repaid"]:::step
    G -->|instalment late > grace| I["8b · Auto-default<br/>+ escrow claim"]:::auto
    H & I --> J["9 · Broker closes<br/>LoanDelete"]:::step
    G -->|"CancelAfter passed"| K["Escrows of paid instalments<br/>returned to the PS"]:::auto
```

## 1. Registration

Two paths depending on the role. Page: `/login` (`app/login/auth-form.tsx`, 3 tabs:
*Log in*, *Create account*, *Connect wallet*).

```mermaid
flowchart TB
    classDef custodial fill:#fde68a,stroke:#b45309,color:#111
    classDef walletOnly fill:#bfdbfe,stroke:#1d4ed8,color:#111
    classDef ledger fill:#d1fae5,stroke:#047857,color:#111

    Start(("/login")) --> Choice{Role?}
    Choice -->|broker · borrower| Reg["Create account<br/>company · email · password · role"]:::custodial
    Choice -->|lender · protection-seller| Wal["Connect wallet"]:::walletOnly

    Reg --> R1["actions.ts › register"]:::custodial
    R1 --> R2["accounts.ts › registerUser<br/>Wallet.generate() · scrypt(password)"]:::custodial
    R2 --> Fund["platform.ts › fundXRP<br/>Payment 10,000 XRP from the genesis"]:::ledger
    Fund --> R3["registry.users.push<br/>seed written to registry.json"]:::custodial
    R3 --> Sess["session.ts › setSession(userId)"]

    Wal --> W{seed?}
    W -->|paste a seed| W1["actions.ts › connectWalletAction<br/>accounts.ts › connectWalletAccount<br/>Wallet.fromSeed"]:::walletOnly
    W -->|generate| W2["actions.ts › generateWalletAction<br/>accounts.ts › generateWalletAccount<br/>Wallet.generate() + fundXRP"]:::walletOnly
    W2 --> Fund
    W1 & W2 --> W3["registry.users.push<br/>address only, never the seed"]:::walletOnly
    W3 --> SessW["session.ts › setSession(userId, seed)<br/>seed AES-256-GCM encrypted in the cookie"]

    Sess & SessW --> Dash["/dashboard → ROLE_HOME[role]"]
```

| Role | Function | Transactions | Where the seed goes |
|---|---|---|---|
| broker, borrower | `registerUser` | `Payment` genesis → wallet (10,000 XRP) | `registry.json` |
| lender, PS (new) | `generateWalletAccount` | `Payment` genesis → wallet | encrypted cookie, shown once |
| lender, PS (existing) | `connectWalletAccount` | none | encrypted cookie |

No credential is issued at registration: KYC is **per vault** (step 4).

## 2. Broker: create a vault

`actions.ts › createVaultAction` → `vaults.ts › createVault(broker, name, description, firstLoss)`

```mermaid
sequenceDiagram
    autonumber
    actor B as Broker
    participant V as vaults.ts
    participant L as ledger.ts
    participant X as XRPL

    B->>V: createVault(name, description, firstLoss)
    V->>L: getSpendableBalance(broker, 3 objects)
    L-->>V: balance − reserve
    Note over V: firstLoss > balance → AYZE_BROKER_COVER_INSUFFICIENT
    V->>X: VaultCreate (Asset XRP, AssetsMaximum 0, firstComeFirstServe)
    X-->>V: meta → createdIndex("Vault") = vaultID, ShareMPTID
    V->>X: LoanBrokerSet (VaultID, ManagementFeeRate 0, DebtMaximum 0,<br/>CoverRateMinimum 70000, CoverRateLiquidation 100000)
    X-->>V: createdIndex("LoanBroker") = loanBrokerID
    V->>X: LoanBrokerCoverDeposit (LoanBrokerID, Amount = firstLoss)
    X-->>V: tesSUCCESS
    V->>V: registry.vaults.push({vaultID, shareMPTID, loanBrokerID, firstLoss, brokerId})
```

Stops at the first ledger rejection (`AyzeError XRPL_<code>`). One LoanBroker per vault: every loan
of the vault is drawn through it, and the cover must cover 70 % of the total open debt.

## 3. Lender: deposit

`actions.ts › depositAction` → `vaults.ts › deposit(lender, vault, amount)` → `VaultDeposit`.
The lender receives shares (MPT `ShareMPTID`, XLS-33). The registry records `{ vaultID, lenderId }`
to find a vault's lenders when interest is distributed; proportions come from the ledger
(`getShareBalance`).

`withdraw(lender, vault, amount | null)` → `VaultWithdraw` in drops, or in shares
(`mpt_issuance_id`) to redeem everything.

## 4. Borrower: get verified for a vault (KYC XLS-70)

*Be verified* button on `/market`. `actions.ts › beVerifiedAction` →
`credentials.ts › verifyBorrowerForVault(borrower, vault)`.

```mermaid
sequenceDiagram
    autonumber
    actor Bo as Borrower
    participant C as credentials.ts
    participant A as AYZE wallet
    participant Br as Broker wallet
    participant X as XRPL

    Bo->>C: verifyBorrowerForVault
    C->>X: hasCredential(borrower, AYZE, hex("AYZE_KYC"))?
    alt missing
        A->>X: CredentialCreate (Subject borrower, CredentialType AYZE_KYC)
        Bo->>X: CredentialAccept (Issuer AYZE)
    end
    C->>X: hasCredential(borrower, broker, hex("VAULT_" + vaultID[0..16]))?
    alt missing
        Br->>X: CredentialCreate (Subject borrower, CredentialType VAULT_id)
        Bo->>X: CredentialAccept (Issuer broker)
    end
    C->>C: registry: user.credentials += …, vault.verifiedBorrowers += borrower
```

`tecDUPLICATE` on `CredentialCreate` is tolerated (credential issued but not yet accepted).
Before every borrow, `assertVaultAccess` re-reads both credentials on the ledger
(`ledger_entry` type `credential`, `lsfAccepted` flag); registry fallback if the RPC fails.

## 5. Borrower: borrow

`actions.ts › borrowAction` → `loans.ts › borrow(borrower, vault, { paymentTotal, paymentInterval })`

```mermaid
sequenceDiagram
    autonumber
    actor Bo as Borrower
    participant Lo as loans.ts
    participant X as XRPL
    participant AY as AYZE wallet

    Bo->>Lo: borrow(vault, N, interval)
    Lo->>Lo: validateTerms → AYZE_INVALID_TERMS
    Lo->>Lo: assertVaultAccess → AYZE_KYC_REQUIRED
    Lo->>X: vault_info → AssetsAvailable ≥ 1,000? else AYZE_INSUFFICIENT_LIQUIDITY
    Lo->>X: ledger_entry LoanBroker → CoverAvailable ≥ 70 % × (DebtTotal + 1,000)?<br/>else AYZE_BROKER_COVER_INSUFFICIENT
    Lo->>X: account_info borrower → spendable ≥ 5 XRP? else AYZE_INSUFFICIENT_FUNDS
    Lo->>Lo: gracePeriod = defaultGrace(N, interval) = clamp(ceil(10 % × N × interval), 60, interval)
    Lo->>X: autofill LoanSet (Account broker, Counterparty borrower,<br/>PrincipalRequested 1,000 XRP, InterestRate 0, PaymentTotal N, PaymentInterval, GracePeriod)
    Lo->>Lo: broker.sign → signLoanSetByCounterparty(borrower)
    Lo->>X: submitSigned(tx_blob)
    X-->>Lo: createdIndex("Loan") = loanID, StartDate
    Lo->>Lo: schedule = buildSchedule(1,000, StartDate, N) → registry.loans.push (status active)
    Bo->>AY: Payment 5 XRP (0.5 % fee) — sendXRP
    Lo->>Lo: registry: loan.txHashes.ayzeFee
```

If the fee fails the loan already exists: the missing hash shows in the UI and the loan stays active.

## 6. Protection seller: guarantee the loan

`actions.ts › guaranteeAction` → `guarantees.ts › guaranteeLoan(seller, loan)`

For **each remaining instalment** i: one native-XRP `EscrowCreate` PS → broker of
`40 % × principal_i`, `Condition` = PREIMAGE-SHA-256 of a random preimage (fulfillment kept in the
registry), `CancelAfter = due_i + grace + CLAIM_WINDOW (300 s)`.

```mermaid
flowchart LR
    classDef esc fill:#d1fae5,stroke:#047857,color:#111
    PS["PS<br/>locks 400 XRP<br/>(4 instalments × 250 × 40 %)"] --> E1["Escrow #1<br/>100 XRP<br/>CancelAfter due1+grace+300"]:::esc
    PS --> E2["Escrow #2<br/>100 XRP"]:::esc
    PS --> E3["Escrow #3<br/>100 XRP"]:::esc
    PS --> E4["Escrow #4<br/>100 XRP"]:::esc
    E1 & E2 & E3 & E4 -.->|Destination| Broker
```

## 7. Servicing: the automatic loop

`servicing.ts › runServicing()` — started by `instrumentation.ts › startServicing()` every
`SERVICING_INTERVAL_MS` = 15 s, and on demand through `POST /api/servicing/run`. One pass per
process at a time (`inFlight`).

```mermaid
flowchart TB
    classDef fn fill:#fef3c7,stroke:#b45309,color:#111
    Tick(("tick 15 s")) --> Now["ledgerTime()"]
    Now --> Loop{"for each loan<br/>in the registry"}
    Loop -->|status active| Debit["(a) debit<br/>instalment due and unpaid?<br/>→ payInstalment(borrower)"]:::fn
    Debit -->|failure| Late["schedule[i].lastAttemptError<br/>shown as « Late », retried"]
    Debit --> AutoD["(b) autoDefault<br/>now > due + grace?<br/>→ declareDefault(broker, 'auto')<br/>→ claimInsurance"]:::fn
    Loop --> Rel["(c) release<br/>escrow LOCKED, CancelAfter passed,<br/>instalment paid or loan settled?<br/>→ EscrowCancel signed by AYZE"]:::fn
    AutoD --> Rel
    Rel --> Report["ServicingReport<br/>paid · failed · defaulted · released · errors"]
```

### 7a. Pay an instalment

`loans.ts › payInstalment(borrower, loan)` — called by the loop **and** by the manual
*Pay instalment* button (`payInstalmentAction`). *Repay in full* (`repayInFull`) chains every
remaining instalment.

```mermaid
sequenceDiagram
    autonumber
    actor Bo as Borrower
    participant Lo as loans.ts
    participant X as XRPL
    actor PS as Protection seller
    actor Br as Broker
    actor Le as Lenders

    Lo->>X: getLoanState(loanID) → periodicPayment, paymentRemaining, nextPaymentDueDate
    Lo->>Lo: principal_i = last? totalValueOutstanding : periodicPayment
    Lo->>Lo: splitInterest(interest_i) → 50 / 30 / 20; lenderWeights (MPT shares)
    Bo->>X: LoanPay (Amount principal_i, Flags tfLoanLatePayment if now ≥ due)
    Note over Lo,X: tecEXPIRED / tecTOO_SOON → one retry with the other variant
    Bo->>PS: Payment 50 % of interest (or → broker when there is no PS)
    Bo->>Br: Payment 30 % (+ lender share when no lender is on record)
    Bo->>Le: Payment 20 % pro rata of shares, one per lender
    Lo->>X: getLoanState → repaid? registry status = repaid
```

### 7b. Default and insurance

`loans.ts › declareDefault(broker, loan, by)` then `guarantees.ts › claimInsurance(broker, loan)`.
Fired automatically by the loop once `now > due + grace`, or manually by the broker
(*Declare default* → before `due + grace` the ledger answers `tecTOO_SOON`, shown as is).

```mermaid
sequenceDiagram
    autonumber
    actor Br as Broker
    participant Lo as loans.ts
    participant G as guarantees.ts
    participant X as XRPL

    Br->>Lo: declareDefault(loan)
    Lo->>X: getBrokerState (CoverAvailable before)
    Br->>X: LoanManage (LoanID, Flags tfLoanDefault)
    X-->>Lo: cover → vault: min(0.7 × DebtTotal, debt, cover)
    Lo->>X: getBrokerState (CoverAvailable after) → coverApplied
    Lo->>Lo: registry: status defaulted, missedIndex, defaultedBy
    Lo->>G: claimInsurance(broker, loan)
    loop escrows LOCKED, index ≥ missedIndex, now < cancelAfter
        Br->>X: EscrowFinish (Owner PS, OfferSequence, Condition, Fulfillment)
        G->>G: escrow.status = CLAIMED
    end
```

## 8. Close

`actions.ts › closeLoanAction` → `loans.ts › closeLoan(broker, loan)`: possible once the loan is
`repaid` or `defaulted`. `LoanDelete` if the Loan entry still exists. The vault's LoanBroker and
its cover **stay** for the next loans; only a legacy per-loan LoanBroker (vaults from before v1.1)
is drained (`LoanBrokerCoverWithdraw`) then deleted (`LoanBrokerDelete`).

## 9. Lifecycle — states

```mermaid
stateDiagram-v2
    direction LR
    [*] --> active : LoanSet validated
    active --> active : LoanPay instalment i
    active --> repaid : last instalment paid (ledger deletes the Loan)
    active --> defaulted : LoanManage tfLoanDefault<br/>(auto after due + grace, or broker)
    repaid --> closed : closeLoan → LoanDelete if present
    defaulted --> closed : closeLoan → LoanDelete
    closed --> [*]
```

```mermaid
stateDiagram-v2
    direction LR
    [*] --> LOCKED : EscrowCreate by the PS
    LOCKED --> CLAIMED : EscrowFinish by the broker<br/>(default, index ≥ missedIndex, before CancelAfter)
    LOCKED --> RELEASED : EscrowCancel by AYZE<br/>(CancelAfter passed, instalment paid or loan settled)
    LOCKED --> EXPIRED : left the ledger otherwise<br/>(refreshEscrowStatuses)
```

## 10. Demo script

`node frontend/scripts/demo.mjs [--base http://localhost:3000] [--from <step>]` replays the whole
journey against a running dashboard (Playwright, real devnet transactions):
`register → vault → deposit → borrow → guarantee → pay → rbac → default → close → balances`.
