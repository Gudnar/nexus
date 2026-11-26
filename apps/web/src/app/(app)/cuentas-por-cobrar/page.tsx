import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AgingCards } from "@/components/aging-cards";
import { PageHeader } from "@/components/ui";
import { getMe, getReceivables } from "@/lib/api";
import { ReceivablesTable } from "./receivables-table";

export const metadata: Metadata = { title: "Cuentas por cobrar" };

export default async function ReceivablesPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("sales.read")) redirect("/dashboard");
  const report = await getReceivables();
  return (
    <>
      <PageHeader title="Cuentas por cobrar" description={"Lo que te deben tus clientes por ventas a crédito, con su antigüedad. Al día de " + report.asOf + "."} />
      <AgingCards totals={report.totals} />
      <ReceivablesTable report={report} canCollect={perms.has("sales.collect")} />
    </>
  );
}
