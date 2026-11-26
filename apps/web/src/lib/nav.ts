/**
 * Navegación lateral (erp_visual_design_structure.json → applicationShell.sidebar).
 * `ready`: la ruta ya existe. Las demás se muestran deshabilitadas ("Pronto") hasta que
 * se construya su módulo. `permission`: si el usuario no lo tiene, el ítem se oculta
 * (hideUnauthorizedNavigation); la API valida el permiso de todos modos.
 */
export interface NavItem {
  id: string;
  label: string;
  icon: string;
  route: string;
  ready?: boolean;
  permission?: string;
}
export interface NavGroup {
  id: string;
  label: string;
  /** Ícono de la sección contraíble. */
  icon: string;
  /** Sección de un solo destino (sin submenú), como «Inicio». */
  direct?: boolean;
  items: NavItem[];
}

/** Secciones contraíbles del menú lateral. Cada módulo vive en la sección donde se espera encontrarlo. */
export const NAV: NavGroup[] = [
  {
    id: "home", label: "Inicio", icon: "layout-dashboard", direct: true,
    items: [{ id: "dashboard", label: "Inicio", icon: "layout-dashboard", route: "/dashboard", ready: true }],
  },
  {
    id: "contacts", label: "Contactos", icon: "users",
    items: [
      { id: "customers", label: "Clientes", icon: "users", route: "/clientes", permission: "customers.read", ready: true },
      { id: "suppliers", label: "Proveedores", icon: "building-2", route: "/proveedores", permission: "purchases.read", ready: true },
    ],
  },
  {
    id: "purchases", label: "Compras", icon: "truck",
    items: [
      { id: "purchase-orders", label: "Órdenes de compra", icon: "truck", route: "/compras", permission: "purchases.read", ready: true },
      { id: "receipts", label: "Recepciones", icon: "package-check", route: "/compras/recepciones", permission: "purchases.read", ready: true },
      { id: "payables", label: "Cuentas por pagar", icon: "receipt", route: "/cuentas-por-pagar", permission: "purchases.read", ready: true },
    ],
  },
  {
    id: "sales", label: "Ventas", icon: "shopping-cart",
    items: [
      { id: "pos", label: "Punto de venta", icon: "shopping-cart", route: "/punto-de-venta", permission: "sales.create", ready: true },
      { id: "pending-sales", label: "Ventas pendientes", icon: "clock", route: "/ventas-pendientes", permission: "sales.collect_pending", ready: true },
      { id: "sales", label: "Búsqueda de ventas", icon: "search", route: "/ventas", permission: "sales.read", ready: true },
      { id: "quotations", label: "Cotizaciones", icon: "file-text", route: "/cotizaciones", permission: "sales.read", ready: true },
      { id: "orders", label: "Pedidos", icon: "package-check", route: "/pedidos", permission: "sales.read" },
      { id: "receivables", label: "Cuentas por cobrar", icon: "hand-coins", route: "/cuentas-por-cobrar", permission: "sales.read", ready: true },
      { id: "ecommerce", label: "Tienda online", icon: "store", route: "/ecommerce", permission: "tenant.settings.read" },
      { id: "omnichannel", label: "Omnicanal", icon: "messages-square", route: "/omnicanal", permission: "sales.read" },
    ],
  },
  {
    id: "finance", label: "Finanzas", icon: "wallet",
    items: [
      { id: "cash", label: "Cajas y turnos", icon: "wallet", route: "/cajas", permission: "cash.read", ready: true },
      { id: "payments", label: "Pagos", icon: "credit-card", route: "/pagos", permission: "reports.financial.read" },
      { id: "closings", label: "Cierres y arqueos", icon: "clipboard-check", route: "/cierres", permission: "cash.close_session" },
      { id: "reports", label: "Reportes", icon: "chart-no-axes-combined", route: "/reportes", permission: "reports.financial.read" },
    ],
  },
  {
    id: "inventory", label: "Inventario", icon: "layers",
    items: [
      { id: "lots", label: "Existencias y kardex", icon: "layers", route: "/inventario", permission: "inventory.read", ready: true },
      { id: "warehouses", label: "Almacenes y valoración", icon: "warehouse", route: "/inventario/almacenes", permission: "inventory.read", ready: true },
      { id: "transfers", label: "Transferencias", icon: "arrow-left-right", route: "/inventario/transferencias", permission: "inventory.read", ready: true },
    ],
  },
  {
    id: "settings", label: "Configuración", icon: "settings",
    items: [
      { id: "products", label: "Productos", icon: "package", route: "/productos", permission: "catalog.read", ready: true },
      { id: "prices", label: "Listas de precios", icon: "tags", route: "/precios", permission: "pricing.read", ready: true },
      { id: "documents", label: "Documentos e impresión", icon: "printer", route: "/documentos", permission: "documents.manage", ready: true },
      { id: "branches", label: "Sucursales", icon: "map-pin", route: "/sucursales", permission: "branches.read", ready: true },
      { id: "sales-settings", label: "Ventas y cobro", icon: "shopping-cart", route: "/configuracion/ventas", permission: "tenant.settings.update", ready: true },
      { id: "integrations", label: "Integraciones", icon: "plug", route: "/configuracion/integraciones", permission: "integrations.manage", ready: true },
      { id: "account", label: "Mi cuenta y seguridad", icon: "settings", route: "/configuracion", ready: true },
    ],
  },
  {
    id: "security", label: "Seguridad", icon: "shield-check",
    items: [
      { id: "users", label: "Usuarios y roles", icon: "user-cog", route: "/usuarios", permission: "users.read", ready: true },
      { id: "approvals", label: "Aprobaciones", icon: "shield-check", route: "/aprobaciones", permission: "approvals.read", ready: true },
    ],
  },
];

/** Ítem activo: el de la ruta más específica que coincide (así «Recepciones» no enciende también «Órdenes de compra»). */
export function activeItemId(groups: NavGroup[], pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const g of groups) for (const i of g.items) {
    if (!i.ready) continue;
    if ((pathname === i.route || pathname.startsWith(i.route + "/")) && (!best || i.route.length > best.len)) best = { id: i.id, len: i.route.length };
  }
  return best?.id ?? null;
}

/** Oculta ítems sin permiso y grupos que quedan vacíos. */
export function visibleNav(permissions: readonly string[]): NavGroup[] {
  const granted = new Set(permissions);
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || granted.has(i.permission)),
  })).filter((g) => g.items.length > 0);
}

export const BREADCRUMBS: Record<string, string> = {
  "/dashboard": "Resumen",
  "/configuracion/seguridad": "Configuración / Seguridad",
  "/sucursales": "Sucursales",
  "/usuarios": "Usuarios",
  "/productos": "Productos",
  "/productos/importar": "Productos / Importar y exportar",
  "/inventario": "Inventario / Existencias",
  "/inventario/kardex": "Inventario / Kardex",
  "/inventario/transferencias": "Inventario / Transferencias",
  "/inventario/reservas": "Inventario / Reservas",
  "/inventario/conteos": "Inventario / Conteos físicos",
  "/inventario/ajustes": "Inventario / Ajustes",
  "/inventario/almacenes": "Inventario / Almacenes y valoración",
  "/compras": "Compras / Órdenes",
  "/compras/recepciones": "Compras / Recepciones",
  "/proveedores": "Proveedores",
  "/ventas": "Ventas / Búsqueda y deudores",
  "/punto-de-venta": "Ventas / Punto de venta",
  "/cotizaciones": "Cotizaciones",
  "/clientes": "Clientes",
  "/cajas": "Cajas y turnos",
  "/cuentas-por-cobrar": "Cuentas por cobrar",
  "/cuentas-por-pagar": "Cuentas por pagar",
  "/aprobaciones": "Aprobaciones",
  "/documentos": "Documentos e impresión",
  "/configuracion/integraciones": "Configuración / Integraciones",
  "/precios": "Precios",
  "/precios/hoja": "Precios / Edición masiva",
  "/precios/impuestos": "Precios / Impuestos",
  "/precios/cotizador": "Precios / Cotizador",
  "/productos/maestros": "Productos / Categorías, marcas y unidades",
  "/usuarios/roles": "Usuarios / Roles y permisos",
  "/usuarios/horarios": "Usuarios / Horarios de acceso",
};
