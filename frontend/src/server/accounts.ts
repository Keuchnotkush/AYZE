import "server-only";
import { isValidClassicAddress, Wallet } from "xrpl";
import type { RoleId } from "@/lib/roles";
import { hashPassword } from "./auth/password";
import { AyzeError } from "./errors";
import { getXRPBalance } from "./ledger";
import { fundXRP } from "./platform";
import { findUserByEmail, findUserByWallet, newId, updateRegistry, type User } from "./registry";

type RegisterInput = { email: string; password: string; company: string; role: RoleId };

const WALLET_ONLY_ROLES: RoleId[] = ["lender", "protection-seller"];

/**
 * Creates a user with its own XRPL wallet, funded with DEMO_XRP from the devnet genesis.
 * KYC is now per-vault (see credentials.ts), issued lazily when a borrower first draws from a vault.
 *
 * Broker / borrower only: they are custodial accounts (email + password, seed kept in the registry).
 * Lender / protection-seller are wallet-only — see `generateWalletAccount` / `connectWalletAccount`.
 */
export async function registerUser(input: RegisterInput): Promise<User> {
  if (WALLET_ONLY_ROLES.includes(input.role)) {
    throw new AyzeError("AYZE_INVALID_INPUT", "Lenders and protection sellers connect a wallet instead of registering with email.");
  }
  if (findUserByEmail(input.email)) throw new AyzeError("AYZE_EMAIL_TAKEN", "An account already exists for this email.");
  const wallet = Wallet.generate();

  await fundXRP(wallet.address);

  const user: User = {
    id: newId(),
    email: input.email.trim(),
    passwordHash: hashPassword(input.password),
    company: input.company.trim(),
    role: input.role,
    wallet: { address: wallet.address, seed: wallet.seed! },
    createdAt: new Date().toISOString(),
  };
  await updateRegistry((registry) => {
    if (registry.users.some((u) => u.email?.toLowerCase() === user.email!.toLowerCase())) {
      throw new AyzeError("AYZE_EMAIL_TAKEN", "An account already exists for this email.");
    }
    registry.users.push(user);
  });
  return user;
}

/** Needs a `user` whose `wallet.seed` is populated — for custodial roles that's always true;
    for wallet-only roles it must come from `currentUser()`, which merges it in from the session. */
export const walletOf = (user: User) => {
  if (!user.wallet.seed) throw new AyzeError("AYZE_UNAUTHENTICATED", "No wallet seed in session; connect a wallet again.");
  return Wallet.fromSeed(user.wallet.seed);
};

/** First 6 / last 4 chars of an address, used as the display "company" for wallet-only accounts. */
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

async function pushWalletUser(role: RoleId, address: string): Promise<User> {
  const user: User = {
    id: newId(),
    role,
    wallet: { address },
    company: shortAddress(address),
    createdAt: new Date().toISOString(),
  };
  await updateRegistry((registry) => registry.users.push(user));
  return user;
}

/**
 * Wallet-only accounts (lender / protection-seller): no email/password, no seed on disk.
 * `generateWalletAccount` creates and funds a brand new wallet, same as `registerUser` does,
 * and returns its seed once so the caller can show it to the user before it is only ever
 * kept in the encrypted session cookie.
 */
export async function generateWalletAccount(role: RoleId): Promise<{ user: User; seed: string }> {
  if (!WALLET_ONLY_ROLES.includes(role)) throw new AyzeError("AYZE_INVALID_INPUT", "Wallet connect is only for lender / protection-seller accounts.");
  const wallet = Wallet.generate();
  await fundXRP(wallet.address);
  const user = await pushWalletUser(role, wallet.address);
  return { user, seed: wallet.seed! };
}

/**
 * Reconnects (or, the first time, registers) a wallet-only account from a family seed pasted
 * by the user. The seed is never stored; the registry only ever sees the resulting address.
 */
export async function connectWalletAccount(role: RoleId, seed: string): Promise<{ user: User; seed: string }> {
  if (!WALLET_ONLY_ROLES.includes(role)) throw new AyzeError("AYZE_INVALID_INPUT", "Wallet connect is only for lender / protection-seller accounts.");
  let wallet: Wallet;
  try {
    wallet = Wallet.fromSeed(seed.trim());
  } catch {
    throw new AyzeError("AYZE_INVALID_INPUT", "That doesn't look like a valid wallet seed.");
  }
  const existing = findUserByWallet(wallet.address, role);
  const user = existing ?? (await pushWalletUser(role, wallet.address));
  return { user, seed: wallet.seed! };
}

/**
 * Connects a browser-extension wallet (Crossmark / GemWallet) for a wallet-only role. Only the
 * address reaches the server; signing happens in the extension. An address the devnet has never
 * seen is funded from genesis like every other demo wallet.
 */
export async function connectExtensionAccount(role: RoleId, address: string): Promise<User> {
  if (!WALLET_ONLY_ROLES.includes(role)) throw new AyzeError("AYZE_INVALID_INPUT", "Wallet connect is only for lender / protection-seller accounts.");
  if (!isValidClassicAddress(address)) throw new AyzeError("AYZE_INVALID_INPUT", "The extension returned an invalid address.");
  if ((await getXRPBalance(address)) === 0n) await fundXRP(address);
  return findUserByWallet(address, role) ?? (await pushWalletUser(role, address));
}
