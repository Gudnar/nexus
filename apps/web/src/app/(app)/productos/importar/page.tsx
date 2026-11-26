import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogTabs } from "@/components/catalog-tabs";
import { PageHeader } from "@/components/ui";
import { getImportJobs, getMe, getPriceLists } from "@/lib/api";
import { ImportManager } from "./import-manager";

export const metadata: Metadata = { title: "Importar y exportar" };

export default async function ImportPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("catalog.read")) redirect("/dashboard");
  const canManageProducts = perms.has("catalog.manage");
  const canManagePrices = perms.has("pricing.manage");
  const [jobs, lists] = await Promise.all([getImportJobs(), perms.has("pricing.read") ? getPriceLists() : Promise.resolve([])]);

  return (
    <>
      <PageHeader title="Productos" description="Carga o descarga productos y precios con archivos de Excel. Nada se aplica hasta que revises la vista previa y confirmes." />
      <CatalogTabs active="import" />
      <ImportManager
        jobs={jobs}
        lists={lists.filter((l) => l.status === "ACTIVE").map((l) => ({ id: l.id, name: l.name, code: l.code }))}
        canImportProducts={canManageProducts}
        canImportPrices={canManagePrices}
        canExport={perms.has("reports.export")}
      />
    </>
  );
}
