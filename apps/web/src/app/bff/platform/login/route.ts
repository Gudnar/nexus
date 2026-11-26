import { PlatformLoginRequest } from "@erp/contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiPublic, checkSameOriginJson, clientIp, problemResponse } from "@/lib/bff-server";
import { isProd, PT_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  const bad = checkSameOriginJson(req);
  if (bad) return bad;
  const parsed = PlatformLoginRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION", title: "Datos inválidos" }, { status: 400 });
  const res = await apiPublic("/api/v1/platform/auth/login", { body: parsed.data, ip: clientIp(req) });
  if (!res?.ok) return problemResponse(res);
  const t = (await res.json()) as { accessToken: string; expiresIn: number };
  (await cookies()).set(PT_COOKIE, t.accessToken, {
    httpOnly: true, sameSite: "strict", secure: isProd, path: "/", maxAge: t.expiresIn,
  });
  return NextResponse.json({ ok: true });
}
