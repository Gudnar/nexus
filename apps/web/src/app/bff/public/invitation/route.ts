import { AcceptInvitationRequest } from "@erp/contracts";
import { NextResponse } from "next/server";
import { apiPublic, checkSameOriginJson, clientIp, problemResponse } from "@/lib/bff-server";

/** POST {action:"info", token} → datos de la invitación; POST {action:"accept", ...} → la acepta. */
export async function POST(req: Request) {
  const bad = checkSameOriginJson(req);
  if (bad) return bad;
  const body = (await req.json().catch(() => null)) as { action?: string; token?: string } | null;

  if (body?.action === "info") {
    const res = await apiPublic("/api/v1/public/invitations/info", { body: { token: String(body.token ?? "") }, ip: clientIp(req) });
    return res?.ok ? NextResponse.json(await res.json()) : problemResponse(res);
  }
  if (body?.action === "accept") {
    const parsed = AcceptInvitationRequest.safeParse(body);
    if (!parsed.success) return NextResponse.json({ code: "VALIDATION", title: "Datos inválidos" }, { status: 400 });
    const res = await apiPublic("/api/v1/public/invitations/accept", { body: parsed.data, ip: clientIp(req) });
    return res?.ok ? NextResponse.json(await res.json()) : problemResponse(res);
  }
  return NextResponse.json({ code: "VALIDATION" }, { status: 400 });
}
