# XLS-65 — Single Asset Vault

The vault is the liquidity pool of a broker: lenders deposit native XRP and receive MPT shares; the
vault's `LoanBroker` (XLS-66) draws from it. One vault per broker offering, created together with its
LoanBroker. Files: `frontend/src/server/vaults.ts`, `ledger.ts`, `views.ts`.

## Transactions

### `VaultCreate` — `vaults.ts › createVault` (step 1/3)

Signer: broker. Trigger: `createVaultAction`, form "Create a vault" on `/broker`.

| Field | Value | Why |
|---|---|---|
| `Asset` | `{ currency: "XRP" }` | native XRP; no `issuer`, no trust line |
| `AssetsMaximum` | `"0"` | no cap |
| `WithdrawalPolicy` | `vaultStrategyFirstComeFirstServe` | only policy in the spec today |
| `Scale` | omitted | XRP shares are implicitly 6 decimals (drops); setting it is rejected |
| flags | none | public vault — anyone can deposit; access to loans is gated by XLS-70, not by the vault |

After validation: `createdIndex(meta, "Vault")` gives the `VaultID`; `ledgerEntry(vaultID).ShareMPTID`
is stored in the registry (`Vault.shareMPTID`). Pre-check: `getSpendableBalance(broker, 3)` — the
broker's reserve grows by three objects (Vault, its MPToken, LoanBroker).

### `VaultDeposit` — `vaults.ts › deposit`

Signer: lender. Trigger: `depositAction` on `/market`.
`Amount` = drops as a string. Pre-check `getSpendableBalance(lender, 1)` (the share `MPToken` object
costs one owner reserve on first deposit). The registry records `{ vaultID, lenderId }` so
`loans.ts › lenderWeights` can find the vault's lenders when interest is distributed.

### `VaultWithdraw` — `vaults.ts › withdraw`

Signer: lender. Trigger: `withdrawAction` on `/market`.

| Input | `Amount` |
|---|---|
| an XRP amount | drops string — the ledger burns the matching shares at the current price |
| empty ("redeem all") | `{ mpt_issuance_id: ShareMPTID, value: <MPTAmount> }` — every share held |

`Destination` = the lender's own address. Fails with `tecINSUFFICIENT_FUNDS` when `AssetsAvailable`
is below the request (liquidity is out on loans).

## Reads

| Function | RPC | Fields used |
|---|---|---|
| `ledger.ts › getVaultState` | `vault_info` | `AssetsTotal`, `AssetsAvailable`, `shares.OutstandingAmount`, `Scale`, `ShareMPTID`, `Account` (pseudo-account), `Owner` |
| `ledger.ts › getShareBalance` | `account_objects` type `mptoken` | `MPTAmount` of the entry whose `MPTokenIssuanceID` is the vault's `ShareMPTID` |
| `views.ts › toVaultView` | — | marketplace card: liquidity, price per share, `canBorrow` = `AssetsAvailable ≥ TICKET` |
| `views.ts › lenderPosition` | — | shares held and their XRP value |

`AssetsTotal` / `AssetsAvailable` are STNumber fields and can come back as `"1.5e9"`; `amounts.ts ›
fromXRPL` normalises them to drops. Price per share = `AssetsTotal / OutstandingAmount` (both in
6-decimal units for XRP).

## What we rely on

- A vault owned by the broker is a prerequisite for `LoanBrokerSet` (owner of the LoanBroker must be
  the vault owner).
- A default (`LoanManage tfLoanDefault`) moves the LoanBroker's cover into the vault, and the
  unrecovered part of the debt lowers `AssetsTotal`, i.e. the share price — this is how lenders bear
  their 30 % residual loss.

## Not used

`VaultSet` (change `AssetsMaximum` / `Data`), `VaultDelete`, `VaultClawback`, private vaults
(`tfVaultPrivate` + `DomainID`) — see the XLS-70 note on why access control is application-side.
