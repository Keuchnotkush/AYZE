# AYZE

Marketplace of lending vaults on the XRP Ledger. A broker opens a vault and posts first-loss
cover, lenders fund it, borrowers draw fixed tickets against it, and broker-accredited
protection sellers guarantee individual loans with conditional escrows. Everything settles in
**native XRP** — no issuer, no trust lines, no IOU.

Runs against the XRPL lending-hackathon devnet (`wss://lending-hackathon.dev.ripplex.io:51233`,
explorer at `https://custom.xrpl.org/lending-hackathon.dev.ripplex.io`).

## Roles

| Role | Wallet | Can |
|---|---|---|
| Broker | custodial (email + password) | create a vault + first-loss cover, verify borrowers, accredit protection sellers, declare default, claim escrows, close |
| Borrower | custodial (email + password) | get verified per vault, borrow a fixed ticket, pay instalments, repay |
| Lender | wallet-only (Crossmark / GemWallet, or a seed) | deposit / withdraw on any vault |
| Protection seller | wallet-only (Crossmark / GemWallet, or a seed) | get accredited per vault, guarantee an unguaranteed loan |

Both gates are XLS-70 credentials, checked on the ledger before AYZE signs anything:

- **Verified borrower** — AYZE issues `AYZE_KYC`, the vault's broker issues `VAULT_<id>`, the borrower
  accepts both. Required to borrow from that vault.
- **Verified protection seller** — the vault's broker issues `PS_VAULT_<id>` to the seller's address,
  the seller accepts it. Required to guarantee that vault's loans.

Lender and protection-seller seeds never reach the registry; they live in an AES-256-GCM-encrypted
session cookie for the login. AYZE itself is an implicit fifth actor: it issues `AYZE_KYC`, takes a
0.5% origination fee, and signs the `EscrowCancel`s that release protection-seller collateral.

## End-to-end flow

1. **Broker** creates a vault: `VaultCreate` → `LoanBrokerSet` (cover ratio 70%) →
   `LoanBrokerCoverDeposit` of the first-loss amount.
2. **Lender** connects a wallet and deposits (`VaultDeposit`).
3. **Borrower** clicks *Be verified* on the vault (`CredentialCreate` ×2 + `CredentialAccept` ×2),
   then borrows a fixed 1,000 XRP ticket: `LoanSet` (broker + borrower countersign) and a
   `Payment` of the 0.5% AYZE fee.
4. **Broker** accredits a protection seller's address on the vault page (`CredentialCreate`
   `PS_VAULT_<id>`); the **protection seller** accepts it on `/protect` (`CredentialAccept`), then
   guarantees the loan: one `EscrowCreate` per remaining instalment, each locking 40% of that
   instalment's principal under a hashlock condition.
5. A servicing loop (every 15 s) auto-debits each instalment when due (`LoanPay` + interest split
   50/30/20 to protection seller, broker, lenders), releases the matching escrow back to the seller
   (`EscrowCancel`), and auto-declares default (`LoanManage tfLoanDefault`) once an instalment is
   late by more than 10% of the loan duration.
6. On default, the broker claims the locked escrows (`EscrowFinish`). Once a loan is repaid or
   closed, the broker withdraws the residual cover and deletes the loan broker
   (`LoanDelete`, `LoanBrokerCoverWithdraw`, `LoanBrokerDelete`).

## Run

```bash
# Docker (what the demo runs) — mount /data or lose wallets, vaults and loans on restart
docker build -t ayze .
docker run -d --name ayze -p 3000:3000 -v ayze-data:/data ayze

# Local dev
npm install
npm run dev -w frontend        # http://localhost:3000
```

Defaults target the lending-hackathon devnet and need no configuration. To override, copy
`frontend/.env.example` to `frontend/.env.local` (`XRPL_WSS`, `XRPL_GENESIS_SEED`, `AYZE_DATA_DIR`,
`AYZE_SESSION_SECRET`, `NEXT_PUBLIC_XRPL_EXPLORER`). On Railway, attach a Volume; `AYZE_DATA_DIR`
falls back to `RAILWAY_VOLUME_MOUNT_PATH`.

## Test

`npm run check` (lint + unit tests on bps math, amounts, schedule) and `npm run build -w frontend`
(typecheck + build). Tests live in `frontend/src/server/__tests__/`.

**Manual walkthrough**, one browser profile per role (or log out between roles):

1. **Broker** — create account → *Create a vault* (first-loss `2100` XRP = 3 loans).
2. **Lender** — *Connect wallet* (generate a seed, or Crossmark/GemWallet on the devnet) → deposit `1000`+ XRP.
3. **Borrower** — create account → `/market` → *Be verified* → *Borrow 1 000 XRP*, `3` instalments every `60` s.
4. **Protection seller** — *Connect wallet* → copy your address from the header → the broker pastes it under
   *Accredited protection sellers* on the vault page → back on `/protect`, *Accept accreditation* → *Guarantee*.
5. Wait: instalments auto-debit on the 15 s tick; let one lapse past grace to see auto-default, escrow claim and
   *Close loan* on the broker's vault page. `POST /api/servicing/run` forces a tick.

**Scripted end to end** (Playwright, real devnet transactions, against a running dashboard):

```bash
# the default step needs a loan that is NOT auto-debited
docker run -d --name ayze -p 3000:3000 -v ayze-data:/data -e AYZE_AUTODEBIT=off ayze
npm i -D playwright -w frontend && npx playwright install chromium     # once
node frontend/scripts/demo.mjs [--base http://localhost:3000] [--from <step>] | tee demo-run.log
# steps: register, vault, deposit, borrow, accredit, guarantee, pay, rbac, default, close, balances
```

`AYZE_AUTODEBIT=off` only stops the loop from paying instalments on the borrower's behalf; auto-default,
escrow claim and escrow release still run.

## Ledger mapping

| Action | Transactions |
|---|---|
| Fund a new demo wallet | `Payment` (from devnet genesis) |
| Verify a borrower | `CredentialCreate` ×2 (`AYZE_KYC`, `VAULT_<id>`) + `CredentialAccept` ×2 |
| Accredit a protection seller | `CredentialCreate` (`PS_VAULT_<id>`, by the broker) + `CredentialAccept` (by the seller) |
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
frontend/src/app/(app)/     one route per role: dashboard · broker (+ vaults/[id]) · market · borrower · protect
frontend/src/app/api/       accounts/[address] · servicing/run
frontend/src/server/        xrpl client, registry, accounts, vaults, loans, guarantees, credentials, servicing, economics
frontend/src/components/    dashboard widgets and tx forms
docs/specs/                 design specs
```

## Known limits

- **Credentials are enforced by the application, not the ledger.** The vault is public and `LoanSet` has no
  credential requirement, so `borrow()` checks `AYZE_KYC` + `VAULT_<id>` and `planGuarantee()` checks
  `PS_VAULT_<id>` on the ledger before signing. Ledger-side enforcement means XLS-80 (`PermissionedDomain` +
  `tfVaultPrivate`); we left it out because it would also gate every lender, we could not confirm the amendment
  on the devnet, and with no real KYC behind the credential it buys nothing for the demo.
- Broker and borrower keys are custodial (server-held seeds) because `LoanSet` needs the broker's co-signature
  and instalments are auto-debited server-side. Lender and protection seller sign with Crossmark/GemWallet
  (devnet added as a custom network) or a session-cookie seed; Xaman is not supported.
- The registry is a single JSON file with no concurrency control beyond atomic rename; it holds matching and
  secrets only, amounts are always read from the ledger.
- `GracePeriod` is clamped to the ledger's `[60s, PaymentInterval]` bounds, which can shorten the intended
  10%-of-duration grace on very short test loans.
