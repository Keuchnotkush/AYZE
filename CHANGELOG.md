# Changelog

All notable changes to AYZE. Dates are the day the change landed in the working tree.

## [Unreleased] — 2026-09-13

### Added

- **Wallet extensions** — lender and protection seller can connect Crossmark or GemWallet instead of
  pasting a seed (`lib/wallet-extension.ts`, `server/extension.ts`, `ExtensionTxForm`). The server
  prepares `VaultDeposit` / `VaultWithdraw` / the `EscrowCreate` ladder, the extension signs and
  submits, the server verifies every hash on the devnet (`getValidatedTx`) before recording. Connect is
  refused when the extension reports another network. Broker and borrower stay custodial.
- **Protection-seller accreditation** — a broker issues `PS_VAULT_<id>` (XLS-70 `CredentialCreate`) to a
  seller's address from the vault page; the seller accepts it on `/protect` (`CredentialAccept`, seed
  session or extension). `planGuarantee` refuses `AYZE_PS_NOT_ACCREDITED` until the credential is accepted
  on the ledger, so a broker controls who may guarantee their vault's loans.
- **AYZE fee retry** — the 0.5 % origination `Payment` is idempotent (`collectAyzeFee`) and retried by
  the servicing loop when it failed after `LoanSet`; the loan card shows it as pending meanwhile.
- **Live feel** — `AutoRefresh` (router refresh every 15 s, paused when hidden), `Countdown` ticking
  next-due / default timers, `loading.tsx` skeletons for the role pages, spinner on pending buttons.
- **Loan card timeline** — one column per instalment with its escrow underneath, progress bar,
  inline auto-debit error with tooltip.
- **Empty states** with a next step on every page; landing page tagline and role cards.
- `docs/amendments/` — matrix and one page per amendment (XLS-65, XLS-66, XLS-70).

- **Tests** — vitest on `amounts.ts` (drops, STNumber parsing, exact splits) and `economics.ts`
  (fixed amounts, 50/30/20 split, schedule, term bounds, grace clamp); `npm run check` runs them.
- **Dockerfile** rebuilt from the repo root: real lockfile (`npm ci` on the workspace), Next `standalone`
  output, non-root `node` user, `/data` volume for the registry and platform wallet, `.dockerignore`
  keeps `.env*`, `data/`, `node_modules` and docs out of the image.

### Changed

- UI primitives now sit on **shadcn/ui** (`base-nova`, Base UI): `Button` (+ `pending`, `ButtonLink`),
  `Field` (Label + Input), `Segmented` (Tabs), `Card`, `Badge`; theme variables mapped onto the
  tyrian / olympic tokens in `globals.css`, light only. `lib/cn.ts` re-exports shadcn's `cn`.
- `TxForm` fields get a keyboard matching their type on phones (`text` / `numeric` / `decimal`);
  vault name and description no longer force the numeric keypad.
- `Stat` gained `plain` for stats laid out inside cards.

### Fixed

- rippled error codes are matched on `error.data.error` (`isRippledError`); the first credential
  lookup for an unverified borrower no longer surfaces as `AYZE_UNEXPECTED Entry not found`.

## [Unreleased] — 2026-09-12

### Changed — repository layout

- `ayze_src/` scripts grouped by phase under `src/setup/`, `src/lending/`, `src/insurance/`;
  runtime JSON (`accounts.json`, `vault.json`, …) now written to `ayze_src/state/` (git-ignored,
  `.gitkeep` tracked). `package.json` scripts and every `readFileSync`/`writeFileSync` path updated.
- `docs/superpowers/specs/` → `docs/specs/`; `assets/` → `docs/assets/`.
- `frontend/README.md` (create-next-app boilerplate) removed; root `README.md` structure section rewritten.
- `.gitmodules` added for `xrpl-devex-hook` (was a bare gitlink, unresolvable on clone).
- `.gitignore`: per-file JSON list replaced by `ayze_src/state/*`.

### Added

- **Monorepo** — root `package.json` with npm workspaces `ayze_src` (protocol scripts) and
  `frontend` (dashboard). `npm install` at the root installs both; `npm run setup` runs the nine
  protocol scripts in order; `npm run dev` starts the dashboard; `npm run check` typechecks + lints.
- **Dashboard connected to the ledger** (`frontend/src/server/`):
  - `xrpl.ts` shared client + `submit()` that turns any non-`tes` result into a typed `TxError`.
  - `state.ts` reads the `*.json` files written by the scripts and maps UI roles to demo wallets
    (custodial: seeds never leave the server).
  - `ledger.ts` read model over `vault_info`, `ledger_entry`, `account_lines`, `account_objects`
    (vault, loan broker, loan with computed status, USD/share balances, escrow ladder with live status).
  - `actions.ts` Server Actions: `login`/`logout`, `deposit`, `withdraw`, `payLoan`
    (regular / late / full), `depositCover`, `declareDefault`, `claimInsurance`.
  - `session.ts` role cookie + `requireRole()` guard inside every action.
- **Role views** under `/dashboard`: Lender (position, price per share, deposit/withdraw),
  Borrower (loan status, next due, pay instalment / late / full), Broker (debt, cover health, add
  cover, declare default, insurance ladder with claim), Protection seller (capital, locked, paid out,
  escrow ladder).
- **Login wired** — the form now calls the `login` action; the selected role decides which demo
  wallet the dashboard acts with (email/password are not verified in this version).
- Reusable dashboard components: `Stat`, `Card`, `Badge`, `TxForm` (form bound to a Server
  Action showing hash + explorer link or ledger error), `TxButton`, `Address`, `EscrowTable`,
  `LoanStatusBadge`. Formatting helpers in `src/lib/format.ts` (USD, %, ripple epoch, explorer URLs).
- `frontend/.env.example` (`XRPL_WSS`, `AYZE_STATE_DIR`, `NEXT_PUBLIC_XRPL_EXPLORER`).
- `docs/specs/2026-09-12-marketplace-v1-design.md` — design of the next version
  (marketplace of vaults, fixed RBAC, XLS-70 KYC credential, bps economics). See `ROADMAP.md`.
- `ROADMAP.md`, this `CHANGELOG.md`.

### Changed

- `ayze_src/package.json` scripts now run from inside the workspace (`tsx accounts.ts`, not
  `tsx ayze_src/accounts.ts`), `tsconfig.json` `include` adjusted; package renamed `@ayze/protocol`.
- Frontend package renamed from `next` to `@ayze/frontend` — a workspace named `next` shadowed the
  real `next` package at the monorepo root.
- `frontend/next.config.ts`: `serverExternalPackages: ["xrpl"]` (xrpl.js needs Node APIs).
- `README.md`: run instructions for the monorepo, requirement table now maps each script to its
  dashboard action, structure section.
- `.gitignore`: `escrow.json` added (it stores escrow fulfillments); `frontend/.gitignore` no
  longer ignores `.env.example`.

### Fixed

- `ayze_src/default.ts` and `ayze_src/claimInsurance.ts` read a flat `escrow.json`
  (`escrow.escrowID`) while `escrow.ts` writes `{ escrows: [...] }` — both now pick the first
  locked, unexpired escrow (the missed payment) and write the whole file back.
- Stale `npx tsx src/…` hints in `repay.ts` error messages.
- Dashboard no longer shows `NaN` / `Invalid Date` for a defaulted loan (the Loan ledger entry
  keeps existing but drops `NextPaymentDueDate`, `PrincipalOutstanding`, `TotalValueOutstanding`
  after `LoanManage tfLoanDefault`).

### Verified on the hackathon devnet (2026-09-12)

End-to-end from the browser (Playwright), every transaction validated:
VaultDeposit · LoanPay · LoanBrokerCoverDeposit · LoanManage before grace → `tecTOO_SOON`
(guardrail, req. 06) · LoanManage after grace → default · EscrowFinish (insurance claim) ·
VaultWithdraw redeem-all. Explorer:
`https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233`.

### Findings worth knowing (they shape the roadmap)

- **Fees do not go to the vault.** Origination / service / late / close fees and the
  `ManagementFeeRate` share of interest are paid to `LoanBroker.Owner` (the AYZE wallet today);
  the vault only receives principal + net interest. Confirmed on-chain: AYZE ended the cycle with
  6.0000761 USD.
- **The "10 % max loss for the lender" claim did not hold.** On default the ledger only moved
  `CoverRateLiquidation × CoverRateMinimum × DebtTotal` = 400 USD of the 666.67 USD outstanding
  from cover to the vault; lenders absorbed 40 %. `CoverRateLiquidation` must be 100 % (100000)
  for the cover to absorb `CoverRateMinimum × debt`, and `DebtTotal` is broker-wide, so the exact
  split needs one LoanBroker per loan.
- The escrow ladder insures 30 % of *one instalment* (100 USD), not 30 % of the broker's loss.
- `InterestRate` is annualized (max 100 %/yr) and `ManagementFeeRate` is capped at 10 % of
  interest — a flat 6 % split three ways on a minutes-long demo loan cannot be expressed on-chain.

### Known limitations of this version

- Single vault / single loan / single escrow ladder, all read from the JSON files in `ayze_src/`.
- Countdowns ("in 2m 28s") are computed at render time; reload the page to refresh.
- The borrower is topped up from the issuer automatically before a payment (devnet convenience).
- No real authentication: the role selector is the login.
- `npm run setup` must be re-run to demo again once the loan is repaid or defaulted.
