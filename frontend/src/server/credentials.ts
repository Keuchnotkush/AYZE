import "server-only";
import { type CredentialAccept, type CredentialCreate, type Wallet } from "xrpl";
import { walletOf } from "./accounts";
import { AyzeError } from "./errors";
import { hasCredential } from "./ledger";
import { ayzeWallet, ensurePlatform } from "./platform";
import { findUser, updateRegistry, type CredentialRecord, type User, type Vault } from "./registry";
import { submit } from "./xrpl";

/* Per-vault borrower verification (XLS-70). Two credentials are needed to draw from a vault:
   AYZE_KYC issued by the platform wallet (once per borrower) and VAULT_<id> issued by the
   vault's broker wallet. Off-chain checks are assumed done; the ledger holds the proof. */

const hex = (text: string) => Buffer.from(text).toString("hex").toUpperCase();

/** hex("AYZE_KYC") */
export const AYZE_KYC_TYPE = hex("AYZE_KYC");

/** hex("VAULT_" + first 16 hex chars of the vaultID) — 22 bytes, well under the 64-byte limit. */
export const vaultCredentialType = (vault: Vault) => hex(`VAULT_${vault.vaultID.slice(0, 16)}`);

type Issued = { record: CredentialRecord; hashes: string[] };

/** CredentialCreate by `issuer`, then CredentialAccept by `subject`. Tolerates an issued-but-unaccepted credential. */
async function issueAndAccept(issuer: Wallet, subject: Wallet, credentialType: string): Promise<Issued> {
  let create: string | undefined;
  try {
    const tx: CredentialCreate = { TransactionType: "CredentialCreate", Account: issuer.address, Subject: subject.address, CredentialType: credentialType };
    create = (await submit(tx, issuer)).hash;
  } catch (error) {
    if (!(error instanceof AyzeError && error.code === "XRPL_tecDUPLICATE")) throw error;
  }
  const accept: CredentialAccept = { TransactionType: "CredentialAccept", Account: subject.address, Issuer: issuer.address, CredentialType: credentialType };
  const { hash } = await submit(accept, subject);
  return { record: { issuer: issuer.address, type: credentialType, txHashes: { create, accept: hash } }, hashes: create ? [create, hash] : [hash] };
}

export type VerifyResult = { hashes: string[]; issued: CredentialRecord[] };

/** Issues (and accepts) the AYZE_KYC and VAULT_<id> credentials to `borrower`. Sequential; stops at the first failure. */
export async function verifyBorrowerForVault(borrower: User, vault: Vault): Promise<VerifyResult> {
  if (borrower.role !== "borrower") throw new AyzeError("AYZE_FORBIDDEN_ROLE", "Only a borrower can be verified.");
  const broker = findUser(vault.brokerId);
  if (!broker) throw new AyzeError("AYZE_NOT_FOUND", "Broker not found.");
  const platform = await ensurePlatform();
  const ayze = ayzeWallet(platform);
  const brokerWallet = walletOf(broker);
  const subject = walletOf(borrower);
  const vaultType = vaultCredentialType(vault);

  const issued: CredentialRecord[] = [];
  const hashes: string[] = [];
  const need = async (issuer: Wallet, type: string) => {
    if (await hasCredential(subject.address, issuer.address, type)) return;
    const result = await issueAndAccept(issuer, subject, type);
    issued.push(result.record);
    hashes.push(...result.hashes);
  };
  await need(ayze, AYZE_KYC_TYPE);
  await need(brokerWallet, vaultType);

  await updateRegistry((registry) => {
    const user = registry.users.find((u) => u.id === borrower.id);
    if (user && issued.length) user.credentials = [...(user.credentials ?? []), ...issued];
    const v = registry.vaults.find((x) => x.id === vault.id);
    if (v && !(v.verifiedBorrowers ?? []).includes(borrower.id)) v.verifiedBorrowers = [...(v.verifiedBorrowers ?? []), borrower.id];
  });
  return { hashes, issued };
}

/** True when the ledger holds both accepted credentials; falls back to the registry when the RPC fails. */
export async function hasVaultAccess(borrower: User, vault: Vault): Promise<boolean> {
  const broker = findUser(vault.brokerId);
  if (!broker) return false;
  try {
    const platform = await ensurePlatform();
    const subject = borrower.wallet.address;
    const [kyc, vaultCred] = await Promise.all([
      hasCredential(subject, platform.ayze.address, AYZE_KYC_TYPE),
      hasCredential(subject, broker.wallet.address, vaultCredentialType(vault)),
    ]);
    return kyc && vaultCred;
  } catch {
    return (vault.verifiedBorrowers ?? []).includes(borrower.id);
  }
}

export async function assertVaultAccess(borrower: User, vault: Vault) {
  if (!(await hasVaultAccess(borrower, vault))) {
    throw new AyzeError("AYZE_KYC_REQUIRED", "Not verified for this vault: AYZE_KYC and vault credentials are required on the ledger.");
  }
}
