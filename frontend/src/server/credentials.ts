import "server-only";
import { isValidClassicAddress, type CredentialAccept, type CredentialCreate, type Wallet } from "xrpl";
import { walletOf } from "./accounts";
import { AyzeError } from "./errors";
import { getCredentialStatus, hasCredential, type CredentialStatus } from "./ledger";
import { ayzeWallet, ensurePlatform } from "./platform";
import { findUser, readRegistry, updateRegistry, type CredentialRecord, type Loan, type User, type Vault } from "./registry";
import { submit } from "./xrpl";

/* Per-vault borrower verification (XLS-70). Two credentials are needed to draw from a vault:
   AYZE_KYC issued by the platform wallet (once per borrower) and VAULT_<id> issued by the
   vault's broker wallet. Off-chain checks are assumed done; the ledger holds the proof. */

const hex = (text: string) => Buffer.from(text).toString("hex").toUpperCase();

/** hex("AYZE_KYC") */
export const AYZE_KYC_TYPE = hex("AYZE_KYC");

/** hex("VAULT_" + first 16 hex chars of the vaultID) — 22 bytes, well under the 64-byte limit. */
export const vaultCredentialType = (vault: Vault) => hex(`VAULT_${vault.vaultID.slice(0, 16)}`);

/** hex("PS_VAULT_" + first 16 hex chars of the vaultID): the broker's accreditation of a protection seller for this vault. */
export const sellerCredentialType = (vault: Vault) => hex(`PS_VAULT_${vault.vaultID.slice(0, 16)}`);

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

/* ------------------------------------------------------------------ */
/* Protection-seller accreditation (broker → seller, per vault)         */
/* ------------------------------------------------------------------ */

/**
 * The broker issues PS_VAULT_<id> to a protection seller's address (CredentialCreate). The seller
 * accepts it from their own session, since wallet-only roles never leave a key on the server:
 * `acceptAccreditation` (seed session) or the extension flow in extension.ts.
 */
export async function accreditSeller(broker: User, vault: Vault, sellerAddress: string): Promise<{ hash: string | null; status: CredentialStatus }> {
  if (vault.brokerId !== broker.id) throw new AyzeError("AYZE_FORBIDDEN_ROLE", "Only the vault's broker can accredit protection sellers.");
  if (!isValidClassicAddress(sellerAddress)) throw new AyzeError("AYZE_INVALID_INPUT", "That is not a valid XRPL address.");
  const brokerWallet = walletOf(broker);
  const type = sellerCredentialType(vault);
  const before = await getCredentialStatus(sellerAddress, brokerWallet.address, type);
  let hash: string | null = null;
  if (before === "none") {
    const tx: CredentialCreate = { TransactionType: "CredentialCreate", Account: brokerWallet.address, Subject: sellerAddress, CredentialType: type };
    hash = (await submit(tx, brokerWallet)).hash;
  }
  await updateRegistry((registry) => {
    const v = registry.vaults.find((x) => x.id === vault.id);
    if (v && !(v.accreditedSellers ?? []).includes(sellerAddress)) v.accreditedSellers = [...(v.accreditedSellers ?? []), sellerAddress];
  });
  return { hash, status: before === "none" ? "issued" : before };
}

/** The CredentialAccept a seller must sign to activate the broker's accreditation. */
export function acceptAccreditationTx(seller: User, vault: Vault): CredentialAccept {
  const broker = findUser(vault.brokerId);
  if (!broker) throw new AyzeError("AYZE_NOT_FOUND", "Broker not found.");
  return { TransactionType: "CredentialAccept", Account: seller.wallet.address, Issuer: broker.wallet.address, CredentialType: sellerCredentialType(vault) };
}

/** Seed-session sellers accept server-side; extension sellers go through extension.ts. */
export async function acceptAccreditation(seller: User, vault: Vault): Promise<string> {
  if (seller.role !== "protection-seller") throw new AyzeError("AYZE_FORBIDDEN_ROLE", "Only a protection seller can accept an accreditation.");
  const status = await sellerAccreditation(seller, vault);
  if (status === "accepted") throw new AyzeError("AYZE_INVALID_INPUT", "Already accredited for this vault.");
  if (status === "none") throw new AyzeError("AYZE_PS_NOT_ACCREDITED", "The vault's broker has not accredited this wallet.");
  const tx = acceptAccreditationTx(seller, vault);
  const { hash } = await submit(tx, walletOf(seller));
  await recordAccreditationAccepted(seller, vault, hash);
  return hash;
}

export async function recordAccreditationAccepted(seller: User, vault: Vault, acceptHash: string) {
  const broker = findUser(vault.brokerId);
  await updateRegistry((registry) => {
    const user = registry.users.find((u) => u.id === seller.id);
    if (user && broker) user.credentials = [...(user.credentials ?? []), { issuer: broker.wallet.address, type: sellerCredentialType(vault), txHashes: { accept: acceptHash } }];
  });
}

/** Ledger status of the seller's PS_VAULT_<id> credential for `vault`. */
export async function sellerAccreditation(seller: User, vault: Vault): Promise<CredentialStatus> {
  const broker = findUser(vault.brokerId);
  if (!broker) return "none";
  return getCredentialStatus(seller.wallet.address, broker.wallet.address, sellerCredentialType(vault));
}

/** Gate used by both guarantee paths: the seller must hold the accepted accreditation of the loan's vault. */
export async function assertSellerAccredited(sellerAddress: string, loan: Loan) {
  const vault = readRegistry().vaults.find((v) => v.vaultID === loan.vaultID);
  const broker = findUser(loan.brokerId);
  if (!vault || !broker) throw new AyzeError("AYZE_NOT_FOUND", "Vault or broker missing from the registry.");
  if (!(await hasCredential(sellerAddress, broker.wallet.address, sellerCredentialType(vault)))) {
    throw new AyzeError("AYZE_PS_NOT_ACCREDITED", `Not accredited by ${vault.name}'s broker: a PS_VAULT credential accepted on the ledger is required to guarantee its loans.`);
  }
}
