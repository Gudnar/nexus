import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PricingTabs } from "@/components/pricing-tabs";
import { getMe, getPriceLists } from "@/lib/api";
import { Quoter } from "./quoter";

export const metadata: Metadata = { title: "Cotizador" };

export default async function QuotePage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("pricing.read")) redirect("/dashboard");
  const lists = await getPriceLists();

  return (
    <>
      <PageHeader title="Precios" description="Comprueba qué precio e impuestos resultan para un producto y una cantidad, antes de vender." />
      <PricingTabs active="quote" canTaxes={perms.has("taxes.read")} />
      <Quoter lists={lists.filter((l) => l.status === "ACTIVE").map((l) => ({ id: l.id, name: l.name, code: l.code }))} />
    </>
  );
}
