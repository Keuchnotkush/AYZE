import "server-only";
import { Wallet, type CredentialAccept, type CredentialCreate } from "xrpl";
import type { RoleId } from "@/lib/roles";
import { hashPassword } from "./auth/password";
import { AyzeError } from "./errors";
import { hasCredential } from "./ledger";
import { ayzeWallet, DEMO_USD, ensurePlatform, ensureTrustLine, fundXRP, issuerWallet, sendUSD } from "./platform";
import { findUserByEmail, newId, updateRegistry, type User } from "./registry";
import { submit } from "./xrpl";

/** Credential type issued by AYZE once off-chain KYC is done. */
export const KYC_CREDENTIAL_TYPE = Buffer.from("AYZE_KYC").toString("hex").toUpperCase();

type RegisterInput = { email: string; password: string; company: string; role: RoleId };

/**
 * Creates a user with its own funded XRPL wallet. Borrowers also receive the
 * AYZE KYC credential (XLS-70): AYZE issues it, the borrower accepts it.
 */
export async function registerUser(input: RegisterInput): Promise<User> {
  if (findUserByEmail(input.email)) throw new AyzeError("AYZE_EMAIL_TAKEN", "An account already exists for this email.");
  const platform = await ensurePlatform();
  const wallet = Wallet.generate();

  await fundXRP(wallet.address);
  await ensureTrustLine(wallet, platform.issuer.address);
  await sendUSD(issuerWallet(platform), wallet.address, DEMO_USD, platform.issuer.address);

  let credential: User["credential"];
  if (input.role === "borrower") {
    const ayze = ayzeWallet(platform);
    const create: CredentialCreate = {
      TransactionType: "CredentialCreate",
      Account: ayze.address,
      Subject: wallet.address,
      CredentialType: KYC_CREDENTIAL_TYPE,
    };
    await submit(create, ayze);
    const accept: CredentialAccept = {
      TransactionType: "CredentialAccept",
      Account: wallet.address,
      Issuer: ayze.address,
      CredentialType: KYC_CREDENTIAL_TYPE,
    };
    const { hash } = await submit(accept, wallet);
    credential = { issuer: ayze.address, type: KYC_CREDENTIAL_TYPE, txHash: hash };
  }

  const user: User = {
    id: newId(),
    email: input.email.trim(),
    passwordHash: hashPassword(input.password),
    company: input.company.trim(),
    role: input.role,
    wallet: { address: wallet.address, seed: wallet.seed! },
    credential,
    createdAt: new Date().toISOString(),
  };
  await updateRegistry((registry) => {
    if (registry.users.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
      throw new AyzeError("AYZE_EMAIL_TAKEN", "An account already exists for this email.");
    }
    registry.users.push(user);
  });
  return user;
}

/** The KYC proof is the ledger, not the registry. */
export async function assertKyc(user: User) {
  const platform = await ensurePlatform();
  const ok = await hasCredential(user.wallet.address, platform.ayze.address, KYC_CREDENTIAL_TYPE);
  if (!ok) throw new AyzeError("AYZE_KYC_REQUIRED", "No valid AYZE KYC credential found on the ledger for this account.");
}

export const walletOf = (user: User) => Wallet.fromSeed(user.wallet.seed);
