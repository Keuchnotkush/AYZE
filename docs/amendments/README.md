# Amendments in use

Three XLS amendments carry the AYZE protocol; native `Payment` and `Escrow` do the money movements
the specs leave to the application. Every transaction below is signed server-side and submitted
through `xrpl.ts › submit()` (autofill + sign + `submitAndWait`; any non-`tes` result becomes
`AyzeError("XRPL_<code>")`). Files are in `frontend/src/server/`.

| Amendment | Object(s) | Transactions we submit | Reads | Detail |
|---|---|---|---|---|
| **XLS-65** Single Asset Vault | `Vault`, share `MPTokenIssuance` | `VaultCreate`, `VaultDeposit`, `VaultWithdraw` | `vault_info`, `account_objects(mptoken)` | [`xls65/`](xls65/README.md) |
| **XLS-66** Lending Protocol | `LoanBroker`, `Loan` | `LoanBrokerSet`, `LoanBrokerCoverDeposit`, `LoanSet`, `LoanPay`, `LoanManage`, `LoanDelete`, `LoanBrokerCoverWithdraw`, `LoanBrokerDelete` | `ledger_entry` | [`xls66/`](xls66/README.md) |
| **XLS-70** Credentials | `Credential` | `CredentialCreate`, `CredentialAccept` | `ledger_entry(credential)` | [`xls70/`](xls70/README.md) |
| Escrow (native XRP, crypto-conditions) | `Escrow` | `EscrowCreate`, `EscrowFinish`, `EscrowCancel` | `account_objects(escrow)` | `guarantees.ts`, `servicing.ts › release` |
| Payment (native XRP) | — | `Payment` | `account_info`, `account_tx` | `platform.ts › fundXRP / sendXRP` |

## Transaction → function

| Transaction | Signer | Function | Trigger |
|---|---|---|---|
| `VaultCreate` | broker | `vaults.ts › createVault` | `createVaultAction` (`/broker`) |
| `LoanBrokerSet` | broker | `vaults.ts › createVault` | same, step 2 |
| `LoanBrokerCoverDeposit` | broker | `vaults.ts › createVault` | same, step 3 |
| `VaultDeposit` | lender | `vaults.ts › deposit` | `depositAction` (`/market`) |
| `VaultWithdraw` | lender | `vaults.ts › withdraw` | `withdrawAction` (`/market`) |
| `CredentialCreate` | AYZE, then broker | `credentials.ts › issueAndAccept` | `beVerifiedAction` (`/market`) |
| `CredentialAccept` | borrower | `credentials.ts › issueAndAccept` | same |
| `LoanSet` | broker + borrower counter-signature | `loans.ts › borrow` | `borrowAction` (`/market`) |
| `Payment` (0.5 % fee) | borrower → AYZE | `loans.ts › borrow` | same, step 2 |
| `EscrowCreate` × N | protection seller → broker | `guarantees.ts › guaranteeLoan` | `guaranteeAction` (`/protect`) |
| `LoanPay` | borrower | `loans.ts › payInstalment` | `servicing.ts › debit` (auto), `payInstalmentAction`, `repayInFullAction` |
| `Payment` (interest split) | borrower → PS / broker / lenders | `loans.ts › payInstalment` | same |
| `LoanManage` `tfLoanDefault` | broker | `loans.ts › declareDefault` | `servicing.ts › autoDefault` (auto), `declareDefaultAction` |
| `EscrowFinish` | broker | `guarantees.ts › claimInsurance` | inside `declareDefault`, `claimInsuranceAction` |
| `EscrowCancel` | AYZE | `servicing.ts › release` | servicing loop, once `CancelAfter` has passed |
| `LoanDelete` | broker | `loans.ts › closeLoan` | `closeLoanAction` |
| `LoanBrokerCoverWithdraw`, `LoanBrokerDelete` | broker | `loans.ts › closeLoan` | same, legacy per-loan LoanBroker only |
| `Payment` (funding) | devnet genesis → new wallet | `platform.ts › fundXRP` | registration / wallet generation |

## Reads → function

| RPC | Function | Used for |
|---|---|---|
| `vault_info` | `ledger.ts › getVaultState` | liquidity, price per share, `ShareMPTID`, vault pseudo-account |
| `ledger_entry` (index) | `ledger.ts › ledgerEntry`, `getBrokerState`, `getLoanState` | `LoanBroker` cover/debt, `Loan` status and schedule fields |
| `ledger_entry` (`credential`) | `ledger.ts › hasCredential` | KYC gate before a borrow |
| `account_objects` `mptoken` | `ledger.ts › getShareBalance` | lender shares, interest pro-rata |
| `account_objects` `escrow` | `ledger.ts › getLiveEscrows` | mark escrows that left the ledger |
| `account_info` | `ledger.ts › getXRPBalance`, `getSpendableBalance` | balances; reserve-aware gating |
| `server_state` | `ledger.ts › getReserve` | base / owner reserve |
| `ledger` | `ledger.ts › ledgerTime` | ledger clock for due dates and grace |
| `account_tx` | `ledger.ts › getAccountActivity` | last transaction of a wallet |
| tx metadata | `ledger.ts › createdIndex` | `LedgerIndex` of the `Vault`, `LoanBroker`, `Loan`, `Escrow` just created |

rippled error codes (`entryNotFound`, `actNotFound`) are matched with `ledger.ts › isRippledError`
on `error.data.error` — xrpl.js puts the human `error_message` in `error.message`.
