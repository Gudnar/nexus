import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkSameOriginJson } from "@/lib/bff-server";
import { PT_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  const bad = checkSameOriginJson(req, false);
  if (bad) return bad;
  (await cookies()).delete(PT_COOKIE);
  return NextResponse.json({ ok: true });
}
