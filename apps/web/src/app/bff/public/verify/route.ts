import { VerifyTokenRequest } from "@erp/contracts";
import { NextResponse } from "next/server";
import { apiPublic, checkSameOriginJson, clientIp, problemResponse } from "@/lib/bff-server";

export async function POST(req: Request) {
  const bad = checkSameOriginJson(req);
  if (bad) return bad;
  const parsed = VerifyTokenRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_TOKEN", title: "Enlace inválido" }, { status: 400 });
  const res = await apiPublic("/api/v1/public/register/verify", { body: parsed.data, ip: clientIp(req) });
  return res?.ok ? NextResponse.json(await res.json()) : problemResponse(res);
}
