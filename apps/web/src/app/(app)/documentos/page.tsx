import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCashRegisters, getDocTemplates, getMe, getPrinters } from "@/lib/api";
import { DocumentsManager } from "./documents-manager";

export const metadata: Metadata = { title: "Documentos e impresión" };

export default async function DocumentsPage() {
  const me = await getMe();
  if (!me.permissions.includes("documents.manage")) redirect("/dashboard");
  const [templates, printers, registers] = await Promise.all([getDocTemplates(), getPrinters(), me.permissions.includes("cash.read") ? getCashRegisters().catch(() => []) : Promise.resolve([])]);
  return (
    <>
      <PageHeader title="Documentos e impresión" description="Cómo salen impresos el recibo de venta, la cotización y la orden de compra, y qué impresoras usa cada sucursal. Son documentos comerciales internos, no facturas." />
      <DocumentsManager templates={templates} printers={printers} branches={me.branches.map((b) => ({ id: b.id, name: b.name }))} registers={registers.filter((r) => r.status === "ACTIVE").map((r) => ({ id: r.id, name: r.name, branchId: r.branch.id }))} />
    </>
  );
}
