import { SetRegistrationRequest } from "@erp/contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkSameOriginJson, problemResponse } from "@/lib/bff-server";
import { API_URL, PT_COOKIE } from "@/lib/session";

export async function PUT(req: Request) {
  const bad = checkSameOriginJson(req);
  if (bad) return bad;
  const token = (await cookies()).get(PT_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const parsed = SetRegistrationRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION" }, { status: 400 });
  const res = await fetch(`${API_URL}/api/v1/platform/settings/registration`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(parsed.data),
    cache: "no-store",
  }).catch(() => null);
  return res?.ok ? NextResponse.json(await res.json()) : problemResponse(res);
}
