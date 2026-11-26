# ERP ventas

ERP multi-tenant (compras/importación, inventario por lotes, ventas, caja, cierre mensual y reportes), sucesor del sistema Quismar.

**Stack:** Node.js · TypeScript · NestJS · Next.js · PostgreSQL · Prisma · pnpm (workspaces + Turborepo)

## Documentación
- [docs/PLANIFICACION_NUEVO_ERP.md](docs/PLANIFICACION_NUEVO_ERP.md) — arquitectura, fases, seguridad, multi-tenancy.
- [docs/DESCRIPCION_SISTEMA.md](docs/DESCRIPCION_SISTEMA.md) — descripción funcional del sistema original.

## Estructura
```
apps/      api (NestJS, implementada) · web · admin · worker (pendientes)
packages/  db (Prisma) · contracts (Zod) · ui · utils · config
infra/     setup-db.sql (base de datos y roles)
docs/
```

## Puesta en marcha
```bash
corepack enable
pnpm install
cp .env.example .env
# Servicios locales (sin Docker): PostgreSQL 16 y Redis
powershell C:/Users/Gudnar/devtools/start-dev-services.ps1
# psql debe estar en el PATH (C:/Users/Gudnar/devtools/pgsql/bin)
pnpm db:setup          # crea la base `erp` y los roles (pide la clave de postgres)
pnpm db:generate
pnpm db:migrate
```

## Estado
Fase 0 cerrada en lo técnico: ADR-001 a ADR-006 redactados, spike de Prisma + RLS aprobado (ADR-001 aceptado). Pendiente del negocio: ADR-003 (estrategia fiscal SIN).
Fases 1, 3 y 4 cerradas (salvo costos de importación); Fase 5 en curso (5a, 5b y 5c hechas; solo falta la facturación SIN); Fase 6 cerrada. `@erp/db` (esquema v2.1, RLS forzado, 43 pruebas), `@erp/api` (NestJS + Fastify, 498 pruebas) y `@erp/web` (Next.js; diseño del JSON + assets de login; verificado con E2E en Chrome). Acceso con usuario **o** correo, MFA TOTP, recuperación de contraseña, registro autoservicio habilitado por el administrador global (`/plataforma`), administración de la empresa (sucursales, usuarios por invitación, roles, horarios de acceso) y dispatcher del outbox. **Catálogo:** productos y servicios con código automático, categorías en árbol, marcas, unidades con decimales y conversiones, códigos de barras únicos, lote y vencimiento. **Precios:** listas por empresa, sucursal o canal con escalas por cantidad (umbral o progresiva), modalidad con/sin impuestos, vigencia, prioridad, historial inmutable y cotizador. **Impuestos en capas** (ADR-002): impuestos con tasas por vigencia, perfiles fiscales con exenciones motivadas y motor de cálculo; no se precarga ninguna tasa. **Excel:** plantillas, importación de productos y precios con vista previa, confirmación todo-o-nada e idempotente, y exportación que se puede reimportar. **Inventario (Fase 4a):** almacenes por sucursal, lotes como capas de costo, libro de movimientos inmutable (append-only en la base), saldos y valoración transaccionales sin stock negativo (CHECK en la base), valoración FIFO/LIFO/promedio con revaluación al cambiar de método, ajustes con selección manual o automática de lote, reversas que compensan sin borrar, kardex con saldo corrido y conciliación contra el libro; verificado con concurrencia y E2E en Chrome. **Compras (Fase 4b):** proveedores, órdenes de compra (borrador → emitida → parcial → recibida, cancelación y cierre), recepciones parciales o directas que crean el lote al costo pactado, anulación de recepciones al costo original (rechazada si lo recibido ya se usó) y protección contra recibir de más, también en concurrencia. **Transferencias y conteos (Fase 4c):** transferencias entre almacenes con almacén lógico de tránsito (el lote viaja con su costo; cancelación en camino; pérdida en tránsito con motivo), sin interbloqueos aunque se crucen, y conteos físicos con foto por lote, revisión y aplicación de diferencias por quien aprueba. Pendiente de la Fase 4: costos de importación prorrateados a lotes (requiere definir el tratamiento contable de lo ya vendido; se hará con finanzas). **Ventas (Fase 5a):** clientes (NIT único, lista de precios propia, plazo y límite de crédito), cotizaciones (borrador → enviada → aceptada/rechazada/cancelada, con vigencia) y ventas (borrador → confirmada → anulada, con el cobro como dimensión aparte). Cada línea guarda la **foto** del cálculo (lista, tramo aplicado, descuento, base, impuestos desglosados y exenciones): cambiar una lista o una tasa después no altera lo vendido, y la base impide modificar o borrar una venta confirmada. Al confirmar se reprecia el borrador, se valida el crédito, se descuenta el stock con asignación de lote y costo, y se asigna el correlativo sin huecos; admite pago mixto. La cotización aceptada se convierte en venta **conservando su precio** (idempotente). Anular devuelve el stock a su lote y costo originales. **Devoluciones y sobreprecio (Fase 5b):** devoluciones parciales como nota de crédito interna inmutable (el stock vuelve a su lote y costo originales, reduce la deuda del cliente y, si hubo pago de más, registra el reembolso; la venta original no cambia) y cambio de precio de una línea con permiso y motivo obligatorio, que se conserva al editar, confirmar y convertir cotizaciones. **Reservas de stock (Fase 5c):** apartan existencias por lote con vigencia (bajan lo disponible, no lo físico), impiden que otra venta, transferencia o ajuste se lleve lo reservado, se liberan a mano o solas al vencer, y la reserva de una cotización se consume al confirmar la venta que nace de ella. Pendiente de la Fase 5: facturación SIN (ADR-003). **Cajas y turnos (Fase 6a):** cajas por sucursal con una sola sesión abierta a la vez (impuesto por la base), apertura con el fondo contado por denominación, libro de movimientos inmutable (cobros y reintegros de ventas, ingresos, gastos, retiros, traspasos entre cajas y bóveda, reversos por compensación), efectivo esperado calculado por el sistema, arqueo parcial, cierre con foto inmutable, diferencias con justificación y tolerancia configurable (la que la supera la decide otra persona, nunca quien cerró) y reapertura con permiso y rastro. En sucursales con caja, cobrar en efectivo exige un turno abierto a nombre de quien cobra; cerrar y cobrar a la vez nunca deja movimientos tardíos. **Finanzas operativas (Fase 6b):** cuentas por cobrar con antigüedad de saldos (por vencer, 1-30, 31-60, 61-90 y +90 días; el vencimiento es la fecha de venta + el plazo del cliente), cuentas por pagar que nacen de cada recepción de mercadería (con el plazo del proveedor) y pagos a proveedores inmutables aplicados por antigüedad o a documentos concretos, sin pagar nunca de más (tampoco con pagos simultáneos); un pago en efectivo sale del turno de caja y no puede dejarla en negativo. El flujo de aprobaciones llega en la Fase 7. Pendiente: ADR-003 (facturación SIN), snapshot fiscal en documentos (llega con ventas), precios por cliente (llega con clientes) y motor de aprobaciones.

## Pruebas de aislamiento (`@erp/db`)
```bash
# Requiere PostgreSQL con los roles de infra/setup-db.sql y las migraciones aplicadas
pnpm --filter @erp/db migrate:deploy
pnpm --filter @erp/db test        # usa DATABASE_URL (erp_app) y DIRECT_URL (erp_owner)
# ¡Las pruebas VACÍAN la base! Corren solo contra una base terminada en _test (infra/setup-test-db.sql crea erp_test)
# o con ALLOW_DESTRUCTIVE_TESTS=1 (CI). Así no se pierden los datos de trabajo de la base `erp`.
```

## Desarrollo local: arrancar y probar
```bash
# 1. Base de datos con los 3 roles (owner, app, platform) y migraciones
psql -U postgres -h localhost -f infra/setup-db.sql
pnpm --filter @erp/db migrate:deploy
# 2. Datos de demostración (reemplaza el contenido de la base)
pnpm --filter @erp/api seed:demo
# 3. API (4300) y web (4310)
pnpm --filter @erp/api start
pnpm --filter @erp/web dev
```
Con `MAIL_TRANSPORT=log` los correos no salen: se leen en `GET http://localhost:4300/api/v1/dev/mailbox`.
Un administrador global real se crea con `pnpm --filter @erp/api platform:admin <correo> "<nombre>" <contraseña>`.

## Actualizar una base existente
```bash
pnpm --filter @erp/db migrate:deploy
pnpm --filter @erp/db sync:defaults   # permisos nuevos para el Administrador + unidades de medida por defecto
```
`sync:defaults` es idempotente y solo aditivo: los demás roles no se tocan (quien administra la empresa decide qué roles reciben los permisos nuevos, p. ej. `catalog.manage`).
