import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, AT_COOKIE, BRANCH_COOKIE, RT_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  }
  const jar = await cookies();
  const token = jar.get(AT_COOKIE)?.value;
  if (token) {
    await fetch(`${API_URL}/api/v1/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(
      () => null,
    );
  }
  for (const c of [AT_COOKIE, RT_COOKIE, BRANCH_COOKIE]) jar.delete(c);
  return NextResponse.json({ ok: true });
}
