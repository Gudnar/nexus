import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getMe, getMyCashSessions } from "@/lib/api";
import { PendingSales } from "./pending-sales";

export const metadata: Metadata = { title: "Ventas pendientes de cobro" };

export default async function PendingSalesPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("sales.collect_pending")) redirect("/dashboard");
  const sessions = perms.has("cash.open_session") ? await getMyCashSessions().catch(() => []) : [];
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/La_Paz" });
  return (
    <>
      <PageHeader title="Ventas pendientes de cobro" description="Las ventas que el punto de venta dejó guardadas. Cóbralas aquí: al cobrar se descuenta el stock y se registra el pago en tu caja." />
      <PendingSales branches={me.branches.map((b) => ({ id: b.id, name: b.name }))} sessions={sessions} today={today} canDiscard={perms.has("sales.update_draft")} />
    </>
  );
}
