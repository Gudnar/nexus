import { UpdateTenantRequest } from "@erp/contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkSameOriginJson, problemResponse } from "@/lib/bff-server";
import { API_URL, PT_COOKIE } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cambia el estado (activa, prueba, suspendida) o el plan de una empresa. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = checkSameOriginJson(req);
  if (bad) return bad;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  const token = (await cookies()).get(PT_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const parsed = UpdateTenantRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION" }, { status: 400 });
  const res = await fetch(`${API_URL}/api/v1/platform/tenants/${id}`, {
    method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(parsed.data), cache: "no-store",
  }).catch(() => null);
  return res?.ok ? NextResponse.json(await res.json()) : problemResponse(res);
}
