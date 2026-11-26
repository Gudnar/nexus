import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getMe, getSalesSettings } from "@/lib/api";
import { CollectModeForm } from "./collect-mode-form";

export const metadata: Metadata = { title: "Ventas y cobro" };

export default async function SalesSettingsPage() {
  const me = await getMe();
  if (!me.permissions.includes("tenant.settings.update")) redirect("/dashboard");
  const settings = await getSalesSettings();
  return (
    <>
      <PageHeader title="Ventas y cobro" description="Define dónde se cobran las ventas: en el mismo punto de venta o en una caja aparte." />
      <CollectModeForm initial={settings.collectMode} />
    </>
  );
}
