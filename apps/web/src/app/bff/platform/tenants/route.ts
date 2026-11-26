import { CreateTenantRequest } from "@erp/contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkSameOriginJson, problemResponse } from "@/lib/bff-server";
import { API_URL, PT_COOKIE } from "@/lib/session";

/** Alta de una empresa cliente (solo con sesión de plataforma). */
export async function POST(req: Request) {
  const bad = checkSameOriginJson(req);
  if (bad) return bad;
  const token = (await cookies()).get(PT_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const parsed = CreateTenantRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION", detail: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  const res = await fetch(`${API_URL}/api/v1/platform/tenants`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(parsed.data), cache: "no-store",
  }).catch(() => null);
  return res?.ok ? NextResponse.json(await res.json()) : problemResponse(res);
}
