import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkSameOriginJson } from "@/lib/bff-server";
import { API_URL, AT_COOKIE } from "@/lib/session";

/**
 * Proxy autenticado para que los componentes de cliente llamen a la API con la cookie
 * HttpOnly (el navegador nunca ve el token). Lista blanca: seguridad de la propia cuenta,
 * administración de la empresa, catálogo, precios, impuestos e importación/exportación. La API valida permisos y alcance en cada llamada.
 */
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED = [
  /^me\/security$/,
  /^me\/profile$/,
  /^me\/password$/,
  /^me\/mfa\/(setup|enable|disable|recovery-codes)$/,
  new RegExp(`^admin/(branches|users|roles|schedules)(/${ID})?$`),
  new RegExp(`^admin/invitations(/${ID}(/resend)?)?$`),
  new RegExp(`^catalog/(units|categories|brands|products)(/${ID})?$`),
  new RegExp(`^catalog/products/${ID}/images(/signature|/upload|/${ID}(/primary)?)?$`),
  new RegExp("^catalog/image-storage$"),
  new RegExp(`^catalog/product-groups(/${ID}(/variants)?)?$`),
  new RegExp("^integrations(/cloudinary(/test)?)?$"),
  new RegExp(`^pricing/lists(/${ID}(/(grid|prices(/(bulk|${ID}(/history)?)?)?))?)?$`),
  /^pricing\/quote$/,
  new RegExp(`^taxes/(codes|profiles)(/${ID}(/rates)?)?$`),
  new RegExp(`^imports(/(template/(PRODUCTS|PRICES)|preview|${ID}(/confirm)?))?$`),
  new RegExp(`^exports/(products|prices/${ID})$`),
  new RegExp(`^purchasing/(suppliers(/${ID}(/(bank-accounts(/${ID})?|history))?)?|orders(/${ID}(/(issue|cancel|close))?)?|receipts(/${ID}/void)?)$`),
  /^sales\/warehouses$/,
  new RegExp(`^sales/customers(/${ID})?$`),
  new RegExp("^sales/(search|sellers|preview|product-search|settings)$"),
  new RegExp(`^sales/orders(/${ID}(/(discard|confirm|payments|void|returns))?)?$`),
  new RegExp(`^sales/returns(/${ID})?$`),
  new RegExp(`^sales/quotes(/${ID}(/(send|accept|reject|cancel|convert|reserve))?)?$`),
  new RegExp(`^inventory/reservations(/${ID}(/release)?)?$`),
  new RegExp(`^finance/(receivables(/customers/${ID})?|payables(/suppliers/${ID})?|supplier-payments)$`),
  new RegExp(`^cash/(registers(/${ID})?|settings|report|sessions(/mine|/${ID}(/(participants|movements|transfer|count|close|decision|reopen))?)?|movements/${ID}/reverse)$`),
  new RegExp(`^approvals/(workflows(/[A-Z_]+)?|requests(/${ID}(/(decide|cancel|retry))?)?|delegations(/${ID}/revoke)?|delegate-candidates)$`),
  new RegExp(`^documents/(templates(/[A-Z_]+(/preview)?)?|render/[A-Z_]+/${ID}|printers(/${ID}(/(deactivate|test|drawer))?)?|print/[A-Z_]+/${ID})$`),
  new RegExp(`^notifications(/read|/${ID}/read)?$`),
  new RegExp(`^inventory/transfers(/${ID}(/(dispatch|receive|cancel))?)?$`),
  new RegExp(`^inventory/counts(/${ID}(/(lines|submit|cancel|reopen|apply))?)?$`),
  new RegExp(`^inventory/(warehouses(/${ID})?|stock|stock/lots|kardex|adjustments|movements/${ID}/reverse|valuation/policy)$`),
];

async function forward(req: Request, path: string[], method: string) {
  const rel = path.join("/");
  if (!ALLOWED.some((r) => r.test(rel))) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const hasBody = method === "POST" || method === "PATCH" || method === "PUT";
  if (method !== "GET") {
    // Siempre mismo origen; JSON obligatorio cuando hay cuerpo. DELETE no lleva cuerpo.
    const bad = checkSameOriginJson(req, hasBody);
    if (bad) return bad;
  }
  const token = (await cookies()).get(AT_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });

  // La query string (filtros y cursor del listado) se reenvía tal cual.
  const res = await fetch(`${API_URL}/api/v1/${rel}${new URL(req.url).search}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(hasBody ? { "content-type": "application/json" } : {}) },
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
  }).catch(() => null);
  if (!res) return NextResponse.json({ code: "UNAVAILABLE" }, { status: 503 });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };
export const GET = async (req: Request, c: Ctx) => forward(req, (await c.params).path, "GET");
export const POST = async (req: Request, c: Ctx) => forward(req, (await c.params).path, "POST");
export const PATCH = async (req: Request, c: Ctx) => forward(req, (await c.params).path, "PATCH");
export const PUT = async (req: Request, c: Ctx) => forward(req, (await c.params).path, "PUT");
export const DELETE = async (req: Request, c: Ctx) => forward(req, (await c.params).path, "DELETE");
