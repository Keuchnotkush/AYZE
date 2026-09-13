import { NextResponse } from "next/server";
import { isValidClassicAddress } from "xrpl";
import { currentUser } from "@/server/auth/session";
import { getAccountActivity } from "@/server/ledger";

export const dynamic = "force-dynamic";

/** GET /api/accounts/:address → XRP balance + last validated transaction, read from the ledger. */
export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "AYZE_UNAUTHENTICATED" }, { status: 401 });
  const { address } = await params;
  if (!isValidClassicAddress(address)) return NextResponse.json({ error: "AYZE_INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await getAccountActivity(address), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
