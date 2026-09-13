import "server-only";
import path from "node:path";

export const XRPL_WSS =
  process.env.XRPL_WSS ?? "wss://lending-hackathon.dev.ripplex.io:51233";

/** Genesis account of the hackathon standalone ledger; funds every demo wallet. */
export const GENESIS_SEED = process.env.XRPL_GENESIS_SEED ?? "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

/**
 * Directory holding registry.json (users, vaults, loans) and platform.json (AYZE wallet).
 * Falls back to the Railway volume mount path when AYZE_DATA_DIR is unset.
 */
export const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.cwd(),
  process.env.AYZE_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "data",
);

export const SESSION_SECRET = process.env.AYZE_SESSION_SECRET ?? "ayze-dev-session-secret";
