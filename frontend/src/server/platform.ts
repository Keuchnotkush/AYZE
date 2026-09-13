import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Wallet, type Payment } from "xrpl";
import { toXRPL, xrpToDrops, type Drops } from "./amounts";
import { DATA_DIR, GENESIS_SEED } from "./env";
import { getClient, submit } from "./xrpl";

/* Platform account: the AYZE wallet (KYC credential issuer, fee collector, EscrowCancel signer).
   Created once on first use and stored in data/platform.json. Every amount is native XRP, so
   there is no issuer, no trust line and no demo IOU any more. */

export type Platform = {
  network: string;
  ayze: { address: string; seed: string };
  createdAt: string;
};

const FILE = path.join(DATA_DIR, "platform.json");

/** XRP sent from the devnet genesis to every new wallet (demo money; the ticket is 1 000 XRP). */
export const DEMO_XRP: Drops = xrpToDrops(10_000);
/** The platform wallet only pays fees and signs credentials / EscrowCancel. */
const PLATFORM_XRP: Drops = xrpToDrops(100);

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
  const ayze = Wallet.generate();
  await fundXRP(ayze.address, PLATFORM_XRP);

  const platform: Platform = {
    network: client.url,
    ayze: { address: ayze.address, seed: ayze.seed! },
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(platform, null, 2));
  return platform;
}

/** Funds (and activates) `address` from the devnet genesis account. */
export async function fundXRP(address: string, amount: Drops = DEMO_XRP) {
  const genesis = Wallet.fromSeed(GENESIS_SEED);
  return sendXRP(genesis, address, amount);
}

/** Native XRP Payment; `amount` in drops. */
export async function sendXRP(from: Wallet, to: string, amount: Drops) {
  const tx: Payment = {
    TransactionType: "Payment",
    Account: from.address,
    Destination: to,
    Amount: toXRPL(amount),
  };
  return submit(tx, from);
}

export const ayzeWallet = (p: Platform) => Wallet.fromSeed(p.ayze.seed);
