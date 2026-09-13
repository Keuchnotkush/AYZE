import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth/session";
import { runServicing } from "@/server/servicing";

export const dynamic = "force-dynamic";

/** POST /api/servicing/run → one servicing pass now (auto-debit, auto-default, escrow release). */
export async function POST() {
  if (!(await currentUser())) return NextResponse.json({ error: "AYZE_UNAUTHENTICATED" }, { status: 401 });
  try {
    return NextResponse.json(await runServicing(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
