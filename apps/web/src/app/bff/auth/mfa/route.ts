import { MfaVerifyRequest, type TokenResponse } from "@erp/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiPublic, checkSameOriginJson, clientIp, problemResponse, setSessionCookies } from "@/lib/bff-server";

const Body = MfaVerifyRequest.extend({ remember: z.boolean().default(true) });

export async function POST(req: Request) {
  const bad = checkSameOriginJson(req);
  if (bad) return bad;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION", title: "Datos inválidos" }, { status: 400 });
  const { remember, ...body } = parsed.data;

  const res = await apiPublic("/api/v1/auth/mfa/verify", { body, ip: clientIp(req), ua: req.headers.get("user-agent") });
  if (!res?.ok) return problemResponse(res);
  await setSessionCookies((await res.json()) as TokenResponse, remember);
  return NextResponse.json({ ok: true });
}
