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

## Verified run

`node frontend/scripts/demo.mjs` against the Docker image, 2026-09-13, stamp `mtziwbve`, `AYZE_AUTODEBIT=off`
so the default path is reachable (raw log: `docs/demo-run-2026-09-13.txt`). 29 transactions on the lending-hackathon devnet in 6 min 41 s, one rejection
(the deliberate early default). Accounts: broker [`rDNxDu…7Q28`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/accounts/rDNxDuNEk3A3F1JHdyDWjvJGK1K7Sq7Q28) ·
lender [`r39Hss…3z6t`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/accounts/r39Hssx26h9jybS8PcCt1w77eqqHWL3z6t) · borrower [`rM6KdR…WVHw`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/accounts/rM6KdRt2oddBc9uasEYJLP2AyfgL3jWVHw) ·
protection seller [`r3Haqu…suCd`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/accounts/r3HaquRou65QXr77b5JDSTN21Cd6pLsuCd) · AYZE [`rMuEcn…aWC7`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/accounts/rMuEcn2XSEq8BR1AT1CrspX6iVqoPzaWC7).

| time (UTC) | transaction | signer | detail | hash |
|---|---|---|---|---|
| 07:59:21 | `Payment ×4` | genesis → 4 wallets | 10 000 XRP each | [`162786F6…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/162786F6770689C7ACBCBBE7E4817445689DF1F2BF5120EE614C65853EBFD13A) |
| 07:59:42 | `VaultCreate` | broker |  | [`EBDC6983…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/EBDC6983D1594E214B60079F4EB4333D35B0461ACE755F2A2106D45A8D7A5985) |
| 07:59:51 | `LoanBrokerSet` | broker | cover 70 % / liq. 100 % | [`A601D98B…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/A601D98BEDF2E27AE982488449EE49AE7F7E50673BB562CD7DD09106D844FE46) |
| 07:59:52 | `LoanBrokerCoverDeposit` | broker | 2 100 XRP | [`0223AE0F…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/0223AE0F0A0BE9AAC24A631D37C9CE84B76FD14A2AE8BE03FBF4D12F528C029F) |
| 08:00:00 | `VaultDeposit` | lender | 2 500 XRP | [`FAC83DEE…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/FAC83DEE67D5DCC79580A21F39F47E3392EB3E587587998E176AE31BC97C12F7) |
| 08:00:11 | `CredentialCreate` | AYZE → borrower | AYZE_KYC | [`8E6473D0…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/8E6473D020E8014771E7A7CA238891E7B5091D6D30B743F72D495908D169C34B) |
| 08:00:12 | `CredentialAccept` | borrower | AYZE_KYC | [`7903CE6F…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/7903CE6F4ACECC024C366842AAC354F3E99152E93C3FCC2511F6D4FB07027FF5) |
| 08:00:21 | `CredentialCreate` | broker → borrower | VAULT_<id> | [`517A9D00…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/517A9D008B1629996301DC72151F8EBCB155F8BDDF3A906D5C243D7C45021224) |
| 08:00:22 | `CredentialAccept` | borrower | VAULT_<id> | [`61193F50…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/61193F50DAE12A45654F22343ECF80780DE4E1B93C268FA0A46720DB2D88BFDF) |
| 08:00:30 | `LoanSet` | broker + borrower | 1 000 XRP, 3 × 120 s | [`ED149840…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/ED149840598397E243BDC21309FF40DE10E4B993DC50EC36D963589FC1E843BB) |
| 08:00:32 | `Payment` | borrower → AYZE | 5 XRP fee | [`4E4E54C3…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/4E4E54C377E29CB52FF935D5B5F4D2D6B2170A965B26E0CA2012FCC160CE9C02) |
| 08:00:41 | `CredentialCreate` | broker → seller | PS_VAULT_<id> | [`88CFA7E3…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/88CFA7E3DDB6815B8C6F156B87C5ABE13F16884204483F22B2C8F036A8EA500B) |
| 08:00:50 | `CredentialAccept` | seller | PS_VAULT_<id> | [`700B7548…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/700B754836A456C1AC5577B1A6CD4D45C319564C55CF72B3BC5F2F715DDBA827) |
| 08:00:52 | `EscrowCreate ×3` | seller → broker | 3 × 133.33 XRP | [`C7B51AA9…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/C7B51AA91B5044C087DE5484BD2D389BC28CC2DA72C33EF31C9DF51CC1EDFB09) |
| 08:01:11 | `LoanPay` | borrower | 333.33 XRP | [`A0F13BD2…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/A0F13BD2963BF0ED5798D2D64AF0C48CC901E1313553D79FBC20DC7A90A763D3) |
| 08:01:20 | `Payment ×3` | borrower → seller / broker / lender | 10 + 6 + 4 XRP interest | [`12FF92C2…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/12FF92C2343B2F3F78193444AB63FAB1B4012B4E158F3089728E65473118AB17) |
| 08:01:32 | `LoanManage (early)` | broker | **tecTOO_SOON**, expected | [`CECBBAEC…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/CECBBAEC95A477BCF9CC8654E3122F1C15EECF8E10D5B013CA3DD230FAFBFAB6) |
| 08:05:41 | `LoanManage tfLoanDefault` | servicing loop, broker key | instalment #2 late > grace | [`C9A15913…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/C9A1591332E7F0EE270F60359A63F5523726B90239BF32738CCC744998CC083F) |
| 08:05:42 | `EscrowFinish ×2` | broker | claims #2, #3 = 266.67 XRP | [`F4F0CB6F…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/F4F0CB6F13BE8A268877BD9B219FC5116A4E119319B804553B479E9152E02981) |
| 08:06:02 | `LoanDelete` | broker |  | [`FD945403…`](https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233/transactions/FD9454032D921BE848A8EC8C15D169D85AD45370FA3B58A4AEB4EF40081B264B) |

Balances at the end (from 10 000 XRP each): broker **8 170.67** (−2 100 cover, +6 interest, +266.67 claimed),
lender **7 504.00** (−2 500 deposit, +4 interest), borrower **10 641.67** (+1 000 − 5 fee − 353.33 instalment),
protection seller **9 610.00** (−400 locked, +10 premium; escrow #1 returns after `CancelAfter`).
RBAC check in the same run: a lender opening `/borrower` gets `AYZE_FORBIDDEN_ROLE`.

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
