import { LoginRequest, type MfaChallengeResponse, type TokenResponse } from "@erp/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiPublic, checkSameOriginJson, clientIp, problemResponse, setSessionCookies } from "@/lib/bff-server";

const Body = LoginRequest.extend({ remember: z.boolean().default(true) });

/**
 * BFF de login: los tokens nunca llegan al JavaScript del navegador; viajan en cookies
 * HttpOnly. Si la cuenta tiene MFA responde `mfaRequired` y el segundo paso va a /bff/auth/mfa.
 */
export async function POST(req: Request) {
  const bad = checkSameOriginJson(req);
  if (bad) return bad;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION", title: "Datos inválidos" }, { status: 400 });
  const { remember, ...credentials } = parsed.data;

  const res = await apiPublic("/api/v1/auth/login", {
    body: credentials, ip: clientIp(req), ua: req.headers.get("user-agent"),
  });
  if (!res?.ok) {
    if (res?.status === 401) {
      const p = (await res.json().catch(() => ({}))) as { code?: string; errors?: unknown };
      return NextResponse.json({ code: p.code, tenants: p.errors }, { status: 401 });
    }
    return problemResponse(res);
  }

  const body = (await res.json()) as TokenResponse | MfaChallengeResponse;
  if ("mfaRequired" in body) return NextResponse.json({ mfaRequired: true, mfaToken: body.mfaToken, expiresIn: body.expiresIn });
  await setSessionCookies(body, remember);
  return NextResponse.json({ ok: true });
}
