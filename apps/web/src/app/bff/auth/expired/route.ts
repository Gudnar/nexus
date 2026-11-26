import { NextResponse } from "next/server";
import { AT_COOKIE, BRANCH_COOKIE, RT_COOKIE } from "@/lib/session";

/** Sesión vencida o revocada: limpia las cookies y envía al login. */
export function GET(req: Request) {
  const url = new URL("/login", req.url);
  if (new URL(req.url).searchParams.get("reason") === "schedule") url.searchParams.set("outside", "1");
  else url.searchParams.set("expired", "1");
  const res = NextResponse.redirect(url);
  for (const c of [AT_COOKIE, RT_COOKIE, BRANCH_COOKIE]) res.cookies.delete(c);
  return res;
}
