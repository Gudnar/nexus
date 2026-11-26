import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AgingCards } from "@/components/aging-cards";
import { PageHeader } from "@/components/ui";
import { getMe, getPayables, getSupplierPayments } from "@/lib/api";
import { PayablesTable } from "./payables-table";

export const metadata: Metadata = { title: "Cuentas por pagar" };

export default async function PayablesPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("purchases.read")) redirect("/dashboard");
  const [report, payments] = await Promise.all([getPayables(), getSupplierPayments()]);
  return (
    <>
      <PageHeader title="Cuentas por pagar" description={"Lo que debes a tus proveedores por mercadería recibida, con su antigüedad. Al día de " + report.asOf + "."} />
      <AgingCards totals={report.totals} />
      <PayablesTable report={report} payments={payments} canPay={perms.has("purchases.pay")} />
    </>
  );
}
