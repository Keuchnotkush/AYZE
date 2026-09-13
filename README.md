# AYZE

Marketplace of lending vaults on the XRP Ledger. A broker opens a vault and posts first-loss
cover, lenders fund it, borrowers draw fixed tickets against it, and protection sellers
guarantee individual loans with conditional escrows. Everything settles in **native XRP** — no
issuer, no trust lines, no IOU.

Runs against the XRPL lending-hackathon devnet: `wss://lending-hackathon.dev.ripplex.io:51233`,
explorer at `https://custom.xrpl.org/lending-hackathon.dev.ripplex.io`.

## Roles

| Role | Wallet | Can |
|---|---|---|
| Broker | custodial (email + password) | create a vault + first-loss cover, declare default, claim escrows, close |
| Borrower | custodial (email + password) | get verified per vault, borrow a fixed ticket, pay instalments, repay |
| Lender | wallet-only (Crossmark / GemWallet, or a seed pasted or generated) | deposit / withdraw on any vault |
| Protection seller | wallet-only (Crossmark / GemWallet, or a seed pasted or generated) | guarantee an unguaranteed loan |

Lender and protection-seller seeds are never written to the registry; they live only in an
AES-256-GCM-encrypted session cookie for the duration of the login. AYZE itself is a fifth,
implicit actor: it issues the `AYZE_KYC` credential, takes a 0.5% origination fee, and signs the
`EscrowCancel`s that release protection-seller collateral.

## End-to-end flow

1. Broker registers, creates a vault: `VaultCreate` → `LoanBrokerSet` (cover ratio 70%) →
   `LoanBrokerCoverDeposit` of the first-loss amount.
2. Lender connects a wallet and deposits into the vault (`VaultDeposit`).
3. Borrower registers, then clicks "Be verified" on that vault: AYZE issues `AYZE_KYC`, the
   vault's broker issues `VAULT_<id>`, borrower accepts both (`CredentialAccept`).
4. Borrower borrows a fixed 1,000 XRP ticket: `LoanSet` (broker + borrower countersign) and a
   `Payment` of the 0.5% AYZE fee.
5. Protection seller guarantees the loan: one `EscrowCreate` per remaining instalment, each
   locking 40% of that instalment's principal under a hashlock condition.
6. A servicing loop (every 15s) auto-debits each instalment when due, releases the matching
   escrow back to the protection seller (`EscrowCancel`) once paid, and auto-declares default
   (`LoanManage tfLoanDefault`) once an instalment is late by more than 10% of the loan duration.
7. On default, the broker claims the locked escrows (`EscrowFinish`) for the remaining
   instalments; interest on paid instalments was already split 50/30/20 between protection
   seller, broker, and lenders as it was collected.
8. Once a loan is repaid or closed, the broker can withdraw the residual cover and delete the
   loan broker.

## Run

**Docker** (what the demo runs):

```bash
docker build -t ayze .
docker run -d --name ayze -p 3000:3000 -v ayze-data:/app/data ayze
```

**Local dev:**

```bash
npm install
npm run dev -w frontend        # http://localhost:3000
```

Defaults target the lending-hackathon devnet and need no configuration. To override, copy
`frontend/.env.example` to `frontend/.env.local` (`XRPL_WSS`, `XRPL_GENESIS_SEED`, `AYZE_DATA_DIR`,
`AYZE_SESSION_SECRET`, `NEXT_PUBLIC_XRPL_EXPLORER`). Wallets, vaults and loans live in `data/` (mount it
or lose them on restart).

## Test

**Checks:** `npm run check` (lint), `npm run build -w frontend` (typecheck + build, what Docker runs).

**Manual walkthrough**, one browser profile per role (or log out between roles):

1. **Broker** — create account → *Create a vault* (first-loss `2100` XRP = 3 loans).
2. **Lender** — *Connect wallet* (generate a seed, or Crossmark/GemWallet on the devnet) → deposit `1000`+ XRP into the vault.
3. **Borrower** — create account → `/market` → *Be verified* (2 credentials) → *Borrow 1 000 XRP* with `3` instalments every `60` s.
4. **Protection seller** — *Connect wallet* → note your address in the header → the broker pastes it under
   *Accredited protection sellers* on the vault page → back on `/protect`, *Accept accreditation* → *Guarantee*.
5. Wait: instalments auto-debit every 15 s tick; let one lapse past grace to see auto-default, escrow claim and
   *Close loan* on the broker's vault page. `POST /api/servicing/run` forces a tick.

**Scripted end to end** (Playwright, real devnet transactions, against a running dashboard):

```bash
node frontend/scripts/demo.mjs [--base http://localhost:3000] [--from <step>]
# steps: register, vault, deposit, borrow, accredit, guarantee, pay, rbac, default, close, balances
# lender / protection-seller seeds are kept in frontend/scripts/.demo-<stamp>.json for --from reruns
```

## Ledger mapping

| Action | Transactions |
|---|---|
| Fund a new demo wallet | `Payment` (from devnet genesis) |
| Borrower verification | `CredentialCreate` ×2 (AYZE, vault's broker) + `CredentialAccept` ×2 |
| Create vault | `VaultCreate` → `LoanBrokerSet` → `LoanBrokerCoverDeposit` |
| Lender deposit / withdraw | `VaultDeposit` / `VaultWithdraw` |
| Borrow | `LoanSet` (broker + borrower countersign) + `Payment` (0.5% AYZE fee) |
| Guarantee a loan | `EscrowCreate` × remaining instalments |
| Pay an instalment | `LoanPay` + `Payment` × (protection seller / broker / lenders interest split) |
| Release a paid instalment's escrow | `EscrowCancel` |
| Default | `LoanManage tfLoanDefault` |
| Claim insurance | `EscrowFinish` × locked escrows |
| Close a loan / vault | `LoanDelete`, `LoanBrokerCoverWithdraw` + `LoanBrokerDelete` |

## Project layout

```
frontend/
  src/app/(app)/            one route per role: dashboard · broker (+ vaults/[id]) · market · borrower · protect
  src/app/api/               accounts/[address] (balance/tx lookups) · servicing/run
  src/server/                 xrpl client, registry, accounts, vaults, loans, guarantees,
                               credentials, servicing, economics, ledger reads, Server Actions
  src/components/dashboard/  stats, tx forms, account-activity, run-servicing, forbidden
  data/                       registry.json · platform.json (git-ignored)
docs/specs/                  design specs
```

## Known limits

- Broker and borrower keys are custodial (server-held seeds); lender and protection-seller keys
  live only in an encrypted session cookie — neither is a real non-custodial wallet flow.
- The application registry is a single JSON file (`registry.json`) with no concurrency control
  beyond atomic rename; it is matching/secrets only, amounts are always read from the ledger.
- `GracePeriod` is clamped to the ledger's `[60s, PaymentInterval]` bounds, which can shorten the
  intended 10%-of-duration grace on very short test loans.
- Lender and protection seller can sign in with **Crossmark or GemWallet** (the extension must have
  the lending-hackathon devnet added as a custom network): the server prepares `VaultDeposit`,
  `VaultWithdraw` and the `EscrowCreate` ladder, the extension signs and submits, the server checks
  each hash on the ledger before recording it. Broker and borrower stay custodial because `LoanSet`
  needs the broker's co-signature and instalments are auto-debited server-side. Xaman is not supported.
