import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Wallet, xrpToDrops, type AccountSet, type Payment, type TrustSet } from "xrpl";
import { DATA_DIR, GENESIS_SEED } from "./env";
import { getClient, submit } from "./xrpl";

/* Platform accounts: the test-USD issuer and the AYZE wallet (KYC issuer, fee collector).
   Created once on first use and stored in data/platform.json. */

export type Platform = {
  network: string;
  issuer: { address: string; seed: string };
  ayze: { address: string; seed: string };
  createdAt: string;
};

const FILE = path.join(DATA_DIR, "platform.json");
const FUND_XRP = "100";
const ASF_DEFAULT_RIPPLE = 8;
const ASF_ALLOW_TRUSTLINE_LOCKING = 17; // required for IOU escrows (XLS-85)

export const USD_LIMIT = "1000000";
export const DEMO_USD = "10000";

export function readPlatform(): Platform | null {
  return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf8")) as Platform) : null;
}

let bootstrapping: Promise<Platform> | null = null;

export function ensurePlatform(): Promise<Platform> {
  const existing = readPlatform();
  if (existing) return Promise.resolve(existing);
  bootstrapping ??= bootstrap().finally(() => (bootstrapping = null));
  return bootstrapping;
}

async function bootstrap(): Promise<Platform> {
  const client = await getClient();
  const issuer = Wallet.generate();
  const ayze = Wallet.generate();
  await fundXRP(issuer.address);
  await fundXRP(ayze.address);

  const rippling: AccountSet = { TransactionType: "AccountSet", Account: issuer.address, SetFlag: ASF_DEFAULT_RIPPLE };
  await submit(rippling, issuer);
  const locking: AccountSet = { TransactionType: "AccountSet", Account: issuer.address, SetFlag: ASF_ALLOW_TRUSTLINE_LOCKING };
  await submit(locking, issuer);

  const platform: Platform = {
    network: client.url,
    issuer: { address: issuer.address, seed: issuer.seed! },
    ayze: { address: ayze.address, seed: ayze.seed! },
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(platform, null, 2));

  // AYZE holds USD (fees) → needs a trust line.
  await ensureTrustLine(ayze, platform.issuer.address);
  return platform;
}

export async function fundXRP(address: string) {
  const genesis = Wallet.fromSeed(GENESIS_SEED);
  const tx: Payment = {
    TransactionType: "Payment",
    Account: genesis.address,
    Destination: address,
    Amount: xrpToDrops(FUND_XRP),
  };
  return submit(tx, genesis);
}

export async function ensureTrustLine(wallet: Wallet, issuer: string) {
  const client = await getClient();
  const lines = await client.request({ command: "account_lines", account: wallet.address, peer: issuer });
  if (lines.result.lines.some((l) => l.currency === "USD")) return null;
  const tx: TrustSet = {
    TransactionType: "TrustSet",
    Account: wallet.address,
    LimitAmount: { currency: "USD", issuer, value: USD_LIMIT },
  };
  return submit(tx, wallet);
}

export async function sendUSD(from: Wallet, to: string, value: string, issuer: string) {
  const tx: Payment = {
    TransactionType: "Payment",
    Account: from.address,
    Destination: to,
    Amount: { currency: "USD", issuer, value },
  };
  return submit(tx, from);
}

export const issuerWallet = (p: Platform) => Wallet.fromSeed(p.issuer.seed);
export const ayzeWallet = (p: Platform) => Wallet.fromSeed(p.ayze.seed);
export const usdAsset = (p: Platform) => ({ currency: "USD", issuer: p.issuer.address });
