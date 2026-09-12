import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { RoleId } from "@/lib/roles";
import { SESSION_SECRET } from "../env";
import { AyzeError } from "../errors";
import { findUser, type User } from "../registry";

const COOKIE = "ayze_session";

const sign = (userId: string) => createHmac("sha256", SESSION_SECRET).update(userId).digest("hex");

export async function setSession(userId: string) {
  const store = await cookies();
  store.set(COOKIE, `${userId}.${sign(userId)}`, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) return null;
  const [userId, signature] = value.split(".");
  if (!userId || !signature) return null;
  const expected = sign(userId);
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  return findUser(userId);
}

/** Fixed RBAC: one role per account; anything else is AYZE_FORBIDDEN_ROLE. */
export async function requireRole(role: RoleId): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AyzeError("AYZE_UNAUTHENTICATED", "Log in to continue.");
  if (user.role !== role) {
    throw new AyzeError("AYZE_FORBIDDEN_ROLE", `This action is reserved to the ${role} role (you are ${user.role}).`);
  }
  return user;
}
