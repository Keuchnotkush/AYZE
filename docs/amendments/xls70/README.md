# XLS-70 — Credentials

Credentials stand in for KYC. **There is no KYC provider in this demo**: AYZE does no off-chain check
and the broker sets no conditions. The point is to exercise the XLS-70 flow — issue, accept, verify on
the ledger — with credentials that are granted unconditionally to any borrower who asks. What the
ledger proves is *that* the credential was issued and accepted, not *why*.

Three credentials exist. Two are required to draw from a vault:

| Credential | `CredentialType` (hex of) | Issuer | Meaning in a real deployment |
|---|---|---|---|
| `AYZE_KYC` | `"AYZE_KYC"` | AYZE platform wallet (`platform.json`) | the borrower passed the platform's KYC |
| `VAULT_<id>` | `"VAULT_" + first 16 hex chars of the VaultID` (22 bytes, limit 64) | the vault's broker | the borrower meets this broker's conditions |

Files: `frontend/src/server/credentials.ts`, `ledger.ts › hasCredential`, `loans.ts › borrow`.

## Transactions

### `CredentialCreate` then `CredentialAccept` — `credentials.ts › issueAndAccept`

Trigger: `beVerifiedAction`, button **Be verified** on a vault card (`/market`, borrower view).
`verifyBorrowerForVault` calls `issueAndAccept` twice — AYZE first, then the broker — skipping a
credential the borrower already holds (`hasCredential`).

| Step | Signer | Fields |
|---|---|---|
| `CredentialCreate` | issuer (AYZE or broker) | `Subject` = borrower, `CredentialType` |
| `CredentialAccept` | borrower | `Issuer`, `CredentialType` |

Both signers are custodial (seeds in `registry.json` / `platform.json`), which is what makes the
"issue and accept in one click" flow possible. `tecDUPLICATE` on the create is tolerated so an
issued-but-never-accepted credential can still be accepted. No `Expiration`, no `URI`.

Result: 4 transaction hashes on first verification, 0 or 2 afterwards. The registry mirrors the state
(`User.credentials[]`, `Vault.verifiedBorrowers[]`) for display and as a fallback.

## Reads

### `ledger.ts › hasCredential(subject, issuer, credentialType)`

`ledger_entry` with `credential: { subject, issuer, credential_type }` (snake_case — rippled's shape,
the xrpl.js type says `credentialType`). True when the entry exists **and** `Flags & lsfAccepted`
(`0x00010000`): an issued-but-unaccepted credential does not count. `entryNotFound` → false, matched
on `error.data.error` (`isRippledError`).

### `credentials.ts › hasVaultAccess / assertVaultAccess`

Both checks in parallel; the registry mirror is used only when the RPC itself fails. `assertVaultAccess`
throws `AYZE_KYC_REQUIRED` and is the first check in `loans.ts › borrow`; `/market` also disables the
Borrow button and shows a **Verified** badge from the same read.

## Protection-seller accreditation (second use of XLS-70)

A broker decides who may guarantee the loans of their vault. Credential `PS_VAULT_<id>` (hex of
`"PS_VAULT_" + first 16 hex chars of the VaultID`), issuer = the vault's broker, subject = the seller's
address. This one is a genuine two-party flow because sellers are wallet-only and the server never has
their key:

| Step | Signer | Where | Function |
|---|---|---|---|
| `CredentialCreate` | broker | vault page, "Accredit" form (seller address) | `credentials.ts › accreditSeller` |
| `CredentialAccept` | seller | `/protect`, "Accept accreditation" (seed session server-side, or extension via `extension.ts › prepareAcceptAccreditation / recordAcceptAccreditation`) | `credentials.ts › acceptAccreditation` |

`ledger.ts › getCredentialStatus` distinguishes `none` / `issued` (entry exists, `lsfAccepted` clear) /
`accepted`; the vault page shows each accredited address with that state. The gate is
`credentials.ts › assertSellerAccredited`, called from `guarantees.ts › planGuarantee`, so both the
custodial and the extension guarantee paths refuse with `AYZE_PS_NOT_ACCREDITED` until the seller holds
the accepted credential. `/protect` disables *Guarantee* and tells the seller which address to give the
broker.

## Enforcement is application-side (and why)

The vault is public and `LoanSet` has no credential requirement of its own, so the ledger does not
block an unverified borrower — `borrow()` and `planGuarantee()` do, by reading the same `Credential`
entries. The ledger-side alternative is XLS-80: `PermissionedDomainSet` with
`AcceptedCredentials = [{ Issuer: AYZE, CredentialType: AYZE_KYC }, …]`, then `VaultCreate` with
`tfVaultPrivate` + `DomainID`. We chose not to, for three reasons:

1. A private vault gates **deposits** as well: every lender would need a credential from the domain,
   which changes the product (open liquidity, gated borrowing) into a closed club.
2. The domain checks the *vault* boundary, not the *loan*: it cannot express "this seller may
   guarantee loans of this vault", which is what `PS_VAULT_<id>` does.
3. We could not confirm the PermissionedDomains amendment on the lending-hackathon devnet, and with
   no real KYC behind the credential the extra objects add nothing a judge can verify.

If the product needed it, the change is contained: create the domain in `createVault`, add
`DomainID` + `tfVaultPrivate` to the `VaultCreate`, and issue credentials to lenders too.

## Not used

`CredentialDelete`, `Expiration` (and the matching check against ledger time), `URI`,
`DepositPreauth` with `AuthorizeCredentials`, permissioned domains.
