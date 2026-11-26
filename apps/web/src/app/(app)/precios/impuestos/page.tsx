import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PricingTabs } from "@/components/pricing-tabs";
import { getMe, getTaxCodes, getTaxProfiles } from "@/lib/api";
import { TaxesManager } from "./taxes-manager";

export const metadata: Metadata = { title: "Impuestos" };

export default async function TaxesPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("taxes.read")) redirect(perms.has("pricing.read") ? "/precios" : "/dashboard");
  const [codes, profiles] = await Promise.all([getTaxCodes(), getTaxProfiles()]);

  return (
    <>
      <PageHeader title="Precios" description="Impuestos y perfiles fiscales. Los valores los define el responsable fiscal de la empresa: el sistema no trae tasas precargadas." />
      <PricingTabs active="taxes" canTaxes />
      <TaxesManager codes={codes} profiles={profiles} canManage={perms.has("taxes.manage")} />
    </>
  );
}
