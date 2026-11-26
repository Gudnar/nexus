import Link from "next/link";

/** Explica qué falta configurar antes de poder crear compras (proveedor y/o almacén) y lleva a crearlo. */
export function MissingSetup({ suppliers, warehouses }: { suppliers: number; warehouses: number }) {
  const missing = [
    suppliers === 0 && { text: "un proveedor activo", href: "/proveedores", link: "Ir a Proveedores" },
    warehouses === 0 && { text: "un almacén activo", href: "/inventario/almacenes", link: "Ir a Almacenes y valoración" },
  ].filter(Boolean) as { text: string; href: string; link: string }[];
  if (missing.length === 0) return null;
  return (
    <div role="status" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-body">
      <p className="font-medium text-ink">Antes de continuar falta crear {missing.map((m) => m.text).join(" y ")}.</p>
      <p className="mt-1 text-ink-2">
        {warehouses === 0 && "La mercadería se recibe en un almacén de una sucursal. "}
        {missing.map((m, i) => (
          <span key={m.href}>{i > 0 && " · "}<Link href={m.href} className="font-medium text-brand hover:underline">{m.link} →</Link></span>
        ))}
      </p>
    </div>
  );
}
