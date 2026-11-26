import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getMe, getMyCashSessions, getSale, getSalesSettings, getSalesWarehouses } from "@/lib/api";
import { PointOfSale } from "./point-of-sale";

export const metadata: Metadata = { title: "Punto de venta" };

export default async function PointOfSalePage({ searchParams }: { searchParams: Promise<{ venta?: string }> }) {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("sales.create")) redirect("/dashboard");
  const { venta } = await searchParams;
  const [warehouses, settings, sessions, initial] = await Promise.all([
    getSalesWarehouses(),
    getSalesSettings().catch(() => ({ collectMode: "AT_POS" as const })),
    perms.has("cash.open_session") ? getMyCashSessions().catch(() => []) : Promise.resolve([]),
    venta && /^[0-9a-f-]{36}$/.test(venta) ? getSale(venta).catch(() => null) : Promise.resolve(null),
  ]);
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/La_Paz" });
  return (
    <>
      <PageHeader title="Punto de venta" description="Busca al cliente y los productos, deja que el precio se elija según la cantidad y cobra con una o varias formas de pago." />
      <PointOfSale
        key={initial?.id ?? "nueva"}
        branches={me.branches.map((b) => ({ id: b.id, name: b.name }))}
        warehouses={warehouses}
        sessions={sessions}
        initial={initial && initial.status === "DRAFT" ? initial : null}
        today={today}
        collectMode={settings.collectMode}
        can={{ create: true, confirm: perms.has("sales.confirm"), collect: perms.has("sales.collect"), void: perms.has("sales.execute_void"), requestVoid: perms.has("sales.request_void") && perms.has("approvals.read"), discount: perms.has("sales.apply_discount"), return: perms.has("sales.return"), override: perms.has("sales.override_price"), createCustomer: perms.has("customers.manage"), collectPending: perms.has("sales.collect_pending") }}
      />
    </>
  );
}
