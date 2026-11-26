import Link from "next/link";

export function InventoryTabs({ active, canAdjust }: { active: "stock" | "kardex" | "transfers" | "reservations" | "counts" | "adjust" | "warehouses"; canAdjust: boolean }) {
  const tab = (id: string, href: string, label: string) => (
    <Link href={href} aria-current={active === id ? "page" : undefined}
      className={`border-b-2 px-1 pb-2.5 text-[13px] font-medium ${active === id ? "border-brand text-brand-hover" : "border-transparent text-ink-2 hover:text-ink"}`}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Secciones de inventario" className="mb-6 flex flex-wrap gap-x-6 border-b border-line">
      {tab("stock", "/inventario", "Existencias")}
      {tab("kardex", "/inventario/kardex", "Kardex")}
      {tab("transfers", "/inventario/transferencias", "Transferencias")}
      {tab("reservations", "/inventario/reservas", "Reservas")}
      {tab("counts", "/inventario/conteos", "Conteos")}
      {canAdjust && tab("adjust", "/inventario/ajustes", "Ajustes")}
      {tab("warehouses", "/inventario/almacenes", "Almacenes y valoración")}
    </nav>
  );
}
