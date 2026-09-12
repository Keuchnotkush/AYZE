# Roadmap

Where AYZE is going, in the order we intend to build it. Each milestone is shippable on its own;
we do not start the next one before the previous runs end-to-end on the hackathon devnet.

Legend: ✅ done · 🔨 in progress · ⏳ planned · 💡 later

## M0 — Protocol scripts ✅

One script per XLS-65 / XLS-66 / XLS-85 step, driven from the CLI, state in JSON files.
Covers the six hackathon requirements (`README.md`). Kept as-is as the reference implementation.

## M1 — Dashboard on the ledger ✅ (2026-09-12)

Next.js dashboard reading the validated ledger and submitting real transactions through Server
Actions, one view per role, custodial demo wallets. Verified end-to-end (see `CHANGELOG.md`).

## M2 — Marketplace V1 🔨

Design: `docs/specs/2026-09-12-marketplace-v1-design.md` (awaiting review).

Goal: several vaults, several loans, four roles matched through the vault, fixed RBAC, and the
AYZE economics expressed in integer basis points. Nothing gets optimized before this runs.

| # | Deliverable | Notes |
|---|---|---|
| 2.1 | Account creation | new XRPL wallet, funded from genesis, USD trust line + demo USD, password hashed |
| 2.2 | KYC credential (XLS-70) | `CredentialCreate` by AYZE + `CredentialAccept` by the borrower at sign-up; checked on the ledger before every borrow |
| 2.3 | Fixed RBAC + error codes | one role per account; `AYZE_FORBIDDEN_ROLE`, `AYZE_KYC_REQUIRED`, `AYZE_INSUFFICIENT_LIQUIDITY`, `AYZE_BROKER_COVER_INSUFFICIENT`, `AYZE_INSUFFICIENT_FUNDS`, `AYZE_ALREADY_GUARANTEED`, `AYZE_LOAN_NOT_DEFAULTED`, `AYZE_INVALID_TERMS`, ledger `tec` codes passed through |
| 2.4 | Economics module in bps | ticket 1 000 USD · interest 600 bps split PS 5 000 / broker 3 000 / lender 2 000 · AYZE 50 bps · first-loss 7 000 · protection 4 000 · amounts in micro-USD `bigint` |
| 2.5 | Broker: create vault | `VaultCreate` owned by the broker; listed on the marketplace |
| 2.6 | Lender: marketplace | list vaults, deposit, withdraw |
| 2.7 | Borrower: automatic borrow | one `LoanBrokerSet` per loan (cover min 70 %, liquidation 100 %) → `LoanBrokerCoverDeposit` 700 → `LoanSet` (broker + borrower counter-signature) → 5 USD to AYZE; terms: 1–12 instalments, interval ≥ 60 s, grace 60 s–interval |
| 2.8 | Protection seller: guarantee a loan | one conditional escrow per remaining instalment (40 % of its principal), fulfillment kept server-side |
| 2.9 | Instalments and repayment | `LoanPay` principal + `Payment`s for the 6 % interest to PS, broker and lenders pro-rata |
| 2.10 | Default and claim | `LoanManage tfLoanDefault` (guardrail `tecTOO_SOON` before grace), `EscrowFinish` on the remaining escrows, close the loan broker (`LoanBrokerCoverWithdraw` + `LoanBrokerDelete`) |
| 2.11 | Registry | `frontend/data/registry.json` for users / vaults / loans / guarantees; ledger stays the source of truth for amounts |
| 2.12 | Tests | vitest on the bps math and amount serialisation; Playwright scenario on the devnet printing explorer links; RBAC cases |

Open questions to settle during review: what happens to the PS share of interest when a loan has
no guarantor; whether lenders receiving interest as direct `Payment`s (instead of vault yield) is
acceptable for V1; leaving orphan loan brokers behind when a borrow fails mid-sequence.

## M3 — Demo polish ⏳

- Live countdowns and auto-refresh of ledger figures (polling or `router.refresh()` every few seconds).
- Explicit "Get demo USD" button instead of implicit top-ups.
- Transaction history per role (`account_tx`) with explorer links.
- Cleanup of orphan loan brokers, expired escrows shown as returned to the PS.
- `README.md` walkthrough of the marketplace with screenshots.

## M4 — Protocol library ⏳

Extract the XRPL logic shared by `ayze_src` scripts and the dashboard into one package
(`packages/protocol`): pure functions taking `{ client, wallet, params }`, scripts become thin
wrappers. Removes the duplicated `getUSDBalance` / `submit` / `ledgerTime` helpers.

## M5 — Toward production 💡

- Users bring their own wallet (Xaman / Crossmark / GemWallet): the server builds transactions,
  the client signs; only the AYZE and issuer keys stay server-side.
- Manual loan approval by the broker; vault-level guarantees (a PS commits capital to a vault and
  escrows are created automatically at each `LoanSet`).
- Atomic multi-step actions with `Batch` transactions (borrow sequence, instalment + interest
  payments).
- RLUSD on Testnet / Mainnet instead of the test `USD` IOU.
- Real authentication and sessions, SQLite/Postgres registry, multi-process deployment.
- Revisit on-chain interest once loans last long enough for an annualized `InterestRate` to be
  meaningful, and re-evaluate `ManagementFeeRate` for AYZE's cut.

## Spec constraints that drive these choices

Verified against XLS-66 on 2026-09-12:

- `ManagementFeeRate` ≤ 10 000 (10 % of interest); `CoverRateMinimum`, `CoverRateLiquidation` ≤ 100 000; all in 1/10 bps.
- `InterestRate` annualized, 0–100 000 (0–100 %/yr).
- `PaymentInterval` ≥ 60 s; `GracePeriod` between 60 s and `PaymentInterval`; `PaymentTotal` ≥ 1.
- On default: `DefaultCovered = min(DebtTotal × CoverRateMinimum × CoverRateLiquidation, DefaultAmount, CoverAvailable)` with `DebtTotal` of the whole LoanBroker.
- Fixed fees and the management fee go to `LoanBroker.Owner`, redirected into `CoverAvailable` while cover is below the minimum.
- A defaulted `Loan` entry stays on the ledger with `lsfLoanDefault` and without its schedule fields.
