import { RegisterRequest } from "@erp/contracts";
import { NextResponse } from "next/server";
import { apiPublic, checkSameOriginJson, clientIp, problemResponse } from "@/lib/bff-server";

export async function POST(req: Request) {
  const bad = checkSameOriginJson(req);
  if (bad) return bad;
  const parsed = RegisterRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ code: "VALIDATION", title: "Datos inválidos", errors: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const res = await apiPublic("/api/v1/public/register", { body: parsed.data, ip: clientIp(req) });
  return res?.ok ? NextResponse.json({ ok: true }, { status: 202 }) : problemResponse(res);
}
