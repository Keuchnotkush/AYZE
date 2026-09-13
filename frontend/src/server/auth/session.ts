import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { RoleId } from "@/lib/roles";
import { SESSION_SECRET } from "../env";
import { AyzeError } from "../errors";
import { findUser, type User } from "../registry";

const COOKIE = "ayze_session";

/** AES-256-GCM key derived from SESSION_SECRET. GCM's auth tag gives us integrity
    for free, so there is no separate signature to check. */
const KEY = createHash("sha256").update(SESSION_SECRET).digest();

type SessionPayload = { userId: string; seed?: string };

/** Wallet-only roles never write their seed to registry.json: it is encrypted into
    this cookie instead, and gone the moment the user logs out. */
function encode(payload: SessionPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function decode(value: string): SessionPayload | null {
  try {
    const buf = Buffer.from(value, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

/** `seed` is required for wallet-only roles (lender / protection-seller): it is never
    persisted to the registry, only encrypted into this cookie. */
export async function setSession(userId: string, seed?: string) {
  const store = await cookies();
  store.set(COOKIE, encode({ userId, seed }), { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) return null;
  const payload = decode(value);
  if (!payload?.userId) return null;
  const user = findUser(payload.userId);
  if (!user) return null;
  /* Wallet-only roles keep no seed in the registry: merge the one from the session
     cookie in-memory so `walletOf(user)` works exactly like for custodial roles. */
  if (payload.seed && !user.wallet.seed) return { ...user, wallet: { ...user.wallet, seed: payload.seed } };
  return user;
}

/**
 * Page-level RBAC. Returns the user when its role is allowed, otherwise the forbidden message to
 * render: a page must not throw for this, since production RSC errors are stripped to a generic
 * "Something went wrong" (React #441) and the reason would be lost. Unauthenticated → /login.
 */
export async function pageRole(...roles: RoleId[]): Promise<{ user: User; forbidden: null } | { user: null; forbidden: string }> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) {
    return { user: null, forbidden: `This page is reserved to the ${roles.join(" / ")} role (you are ${user.role}).` };
  }
  return { user, forbidden: null };
}

/** Fixed RBAC for server actions: one role per account; anything else is AYZE_FORBIDDEN_ROLE. */
export async function requireRole(role: RoleId): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AyzeError("AYZE_UNAUTHENTICATED", "Log in to continue.");
  if (user.role !== role) {
    throw new AyzeError("AYZE_FORBIDDEN_ROLE", `This action is reserved to the ${role} role (you are ${user.role}).`);
  }
  return user;
}
