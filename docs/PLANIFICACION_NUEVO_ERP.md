# Planificación — ERP multi-tenant (Node.js + TypeScript + PostgreSQL + Prisma + pnpm)

Proyecto sucesor del sistema Quismar (ver `DESCRIPCION_SISTEMA.md`). Objetivo: mismas funcionalidades de negocio (compras/importación, inventario por lotes, ventas, caja, cierre mensual, reportes), pero **SaaS multi-tenant**, con administración global de plataforma, seguridad desde el diseño y base técnica moderna.

---

## 1. Objetivos y alcance

**Objetivos**
1. Varios negocios (tenants) completamente aislados en una sola instalación.
2. Panel global de plataforma (super-admin): alta/suspensión de tenants, planes, módulos habilitados, auditoría, métricas.
3. Seguridad: aislamiento de datos garantizado por la base (RLS), RBAC, auditoría, sin las fallas del sistema actual (SQLi, claves en texto plano, sin permisos).
4. Integridad contable: transacciones atómicas, decimales exactos, periodos bloqueados.

**Fuera de alcance v1**: facturación electrónica oficial (SIN Bolivia), contabilidad completa (plan de cuentas/asientos), app móvil, marketplace. Se dejan puntos de extensión.

---

## 2. Decisiones de arquitectura

| Tema | Decisión | Motivo |
|---|---|---|
| Gestor de paquetes | **pnpm** + workspaces (monorepo) | Instalación rápida, disco compartido, dependencias estrictas, filtros por paquete |
| Orquestación monorepo | pnpm workspaces + **Turborepo** (cache de build/test/lint) | Builds incrementales en CI |
| Lenguaje | TypeScript `strict` en todo | Tipos compartidos front/back |
| Backend | **NestJS** (adapter Fastify), arquitectura modular | DI, guards, módulos por dominio, OpenAPI |
| ORM | **Prisma** + PostgreSQL 16 | Pedido; migraciones versionadas, tipos generados |
| Multi-tenencia | **Base compartida, esquema único, columna `tenantId` + Row-Level Security (RLS) de Postgres** | Escala a muchos tenants, aislamiento forzado por la BD (defensa en profundidad) y no solo por código |
| Frontend | **Next.js (App Router) + React**, Tailwind + shadcn/ui, TanStack Query/Table, React Hook Form + Zod | Reemplaza jQuery/AdminLTE/DataTables |
| Validación | **Zod** (paquete `@erp/contracts`) compartido front/back | Un solo contrato |
| API | REST + OpenAPI (Swagger) generado; cliente tipado generado | Simple, auditable |
| Jobs | **BullMQ + Redis** | PDFs, importaciones Excel, cierres, correos |
| PDF | Playwright/Chromium headless con plantillas HTML (o `pdfmake`) | Reemplaza mPDF/FPDF |
| Excel | `exceljs` | Reemplaza PHPExcel |
| Archivos | Interfaz `StorageService` con driver **disco local** y driver S3 opcional; carpeta/prefijo por tenant | Reemplaza `upload/` |
| Observabilidad | pino (logs JSON), OpenTelemetry, Sentry | |
| Tests | Vitest/Jest (unit), Supertest + Testcontainers Postgres (integración), Playwright (e2e) | |
| CI/CD | GitHub Actions con servicio Postgres; despliegue sin contenedores (Node + PM2 / servicio del SO) | **Sin Docker**: PostgreSQL y Redis instalados localmente |

> Alternativa de aislamiento si algún cliente exige separación física: *schema-per-tenant* o *DB-per-tenant* para planes "enterprise". El diseño con `TenantContext` permite añadirla después sin reescribir dominios.

---

## 3. Estructura del monorepo (pnpm)

```
erp/
├─ pnpm-workspace.yaml
├─ package.json            # "packageManager": "pnpm@9.x", engines node >=20
├─ .npmrc                  # strict-peer-dependencies, auto-install-peers=false
├─ turbo.json
├─ apps/
│  ├─ api/                 # NestJS (REST)
│  ├─ web/                 # Next.js: app del tenant
│  ├─ admin/               # Next.js: consola global de plataforma
│  └─ worker/              # procesos BullMQ (PDF, import, cierres)
├─ packages/
│  ├─ db/                  # schema.prisma, migraciones, seeds, cliente Prisma + extensión de tenant
│  ├─ contracts/           # esquemas Zod + tipos + enums compartidos
│  ├─ config/              # tsconfig/eslint/prettier base
│  ├─ ui/                  # componentes compartidos web/admin
│  └─ utils/               # dinero (decimal.js), fechas, formateo es-BO
├─ infra/                  # setup-db.sql (base y roles), scripts de servicios locales
└─ docs/                   # ADRs, modelo de datos, runbooks
```

**Uso de pnpm**
- `pnpm-workspace.yaml` con `apps/*` y `packages/*`; dependencias internas con `workspace:*`.
- Versión fijada con `corepack` (`packageManager`) y `pnpm-lock.yaml` commiteado; CI usa `pnpm install --frozen-lockfile`.
- Scripts raíz: `pnpm dev` (turbo), `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm db:migrate`, `pnpm db:seed`.
- `pnpm --filter @erp/api ...` para ejecutar por paquete; `pnpm audit` y Renovate/Dependabot en CI.
- `onlyBuiltDependencies` (pnpm 10) / revisión de scripts de postinstall para mitigar supply-chain.

---

## 4. Multi-tenencia y administración global

### 4.1 Niveles de actor
- **Plataforma (global):** `PlatformUser` con rol `SUPER_ADMIN`/`SUPPORT`. Accede solo a `apps/admin`; no está atado a un tenant.
- **Tenant:** `User` pertenece a uno o varios tenants vía `Membership` (rol por tenant).
- Soporte puede "entrar como" un tenant solo con *impersonación* auditada, temporal y con motivo.

### 4.2 Entidades de plataforma
`Tenant` (slug, razón social, NIT, país, moneda base, zona horaria, estado: TRIAL/ACTIVE/SUSPENDED/CANCELLED), `Plan`, `Subscription`, `FeatureFlag/ModuleEnabled` (módulos habilitables por tenant: compras, logística, ventas, caja, cierre, reportes…), `PlatformAuditLog`, `Invitation`.

### 4.3 Aislamiento (3 capas)
1. **Resolución de tenant:** por subdominio (`acme.erp.com`) o claim `tid` del JWT; middleware crea `TenantContext` (AsyncLocalStorage). Nunca se confía en un `tenantId` enviado en el body.
2. **Prisma extension:** toda consulta se ejecuta dentro de una transacción que hace `SELECT set_config('app.tenant_id', $1, true)`; la extensión además inyecta `tenantId` en `create` y lo exige en `where`.
3. **RLS en Postgres:** cada tabla de negocio tiene `tenantId NOT NULL`, índice compuesto y política:
   `USING (tenant_id = current_setting('app.tenant_id')::uuid)` con `FORCE ROW LEVEL SECURITY`. La app se conecta con un rol **sin** `BYPASSRLS`; migraciones usan otro rol. Un test de integración recorre todas las tablas verificando que tengan RLS.

### 4.4 Consecuencias de diseño
- Correlativos (nº factura, nº lote, nº pago) **por tenant**: tabla `Sequence(tenantId, key, value)` con `UPDATE … RETURNING` atómico (no `MAX()+1` como hoy).
- Unicidad siempre compuesta: `@@unique([tenantId, codigo])`.
- Storage, caché Redis y colas con prefijo `tenant:{id}`.
- Límites por plan (usuarios, almacenes, documentos/mes) y rate-limit por tenant.
- Alta de tenant = transacción que crea tenant, admin inicial, catálogos semilla (monedas, gestión, almacén por defecto, roles).

---

## 5. Seguridad

**Autenticación**
- Contraseñas con **argon2id**; política mínima y verificación contra filtradas (HIBP k-anonymity opcional).
- JWT de acceso corto (10–15 min) + **refresh token rotativo** en cookie `HttpOnly; Secure; SameSite=Lax`, almacenado hasheado con detección de reutilización.
- Bloqueo progresivo por intentos fallidos, rate-limit en login, **2FA TOTP** (obligatorio para admin de plataforma y admin de tenant).
- Recuperación de contraseña e invitaciones por token de un solo uso con expiración.

**Autorización**
- **RBAC por tenant**: `Role` → `Permission` (`ventas.crear`, `ventas.anular`, `caja.cerrar`, `inventario.ajustar`…), roles base editables + guard `@RequirePermission()`. Verificación también en el front para ocultar menú (nunca como única barrera).
- Políticas de propiedad (p. ej. solo anular ventas del día, límites de descuento).

**Aplicación**
- Validación Zod en todo input; consultas **solo** con Prisma/parametrizadas (`$queryRaw` con tagged template); prohibido `$queryRawUnsafe` (regla ESLint).
- `helmet`, CORS por lista blanca, CSRF (double-submit/SameSite), límites de tamaño, sanitización de salida, subida de archivos con validación de tipo/tamaño y antivirus opcional.
- Secretos en variables de entorno / gestor de secretos; cifrado en reposo de datos sensibles (campo-level con AES-GCM para claves de integración).
- **Auditoría inmutable** (`AuditLog`: quién, tenant, acción, entidad, antes/después, IP) para ventas, anulaciones, ajustes, cierres, cambios de permisos. Tabla append-only (REVOKE UPDATE/DELETE).
- Backups cifrados diarios + PITR; restauración probada trimestralmente.
- CI: `pnpm audit`, Dependabot/Renovate, escaneo SAST (CodeQL) y de imágenes (Trivy), detección de secretos (gitleaks).
- Cumplimiento: logs sin datos sensibles, retención configurable, exportación/borrado de datos por tenant.

---

## 6. Modelo de dominio (Prisma) — mapeo desde el sistema actual

Convenciones: `id` UUID v7, `tenantId`, `createdAt/updatedAt/createdById`, **borrado lógico** (`deletedAt`) solo donde aplique, **dinero en `Decimal(18,4)`**, cantidades `Decimal(18,4)`, enums Prisma para estados (en vez de strings `ACTIVO/PENDIENTE`).

| Dominio | Entidades nuevas | Origen legado |
|---|---|---|
| Plataforma | Tenant, Plan, Subscription, PlatformUser, ModuleEnabled, PlatformAuditLog | — (nuevo) |
| Identidad | User, Membership, Role, Permission, RolePermission, Session, Invitation, AuditLog | usuario, credencial |
| Configuración | Company, Branch(sucursal), Warehouse(almacen), Currency, ExchangeRate(tipocambiario), FiscalYear(gestion), Sequence, TaxRate | sucursal, almacen, moneda, gestion, tipocambiario, talonario |
| Contactos | Customer, Supplier, Contact(representante), Country, Origin | cliente, proveedor, representante, pais, origen |
| Catálogo | Category, Subcategory, Product, UnitOfMeasure, SupplierProduct, PriceList | categoria, subcategoria, producto, medida/unidad, productoproveedor, precio |
| Compras | PurchaseOrder(ordenentrada), PurchaseLine(entrada), PurchasePayment(ordencompra) | ordenentrada, entrada, ordencompra |
| Logística/Costeo | LandedCost(logistica), CostType(tipogasto), CostAllocation | logistica, tipogasto |
| Inventario | StockItem(almacenproducto), Lot(lote), StockMovement (kardex), StockAdjustment, Transfer | almacenproducto, lote (+ transferencias/ajustes que faltaban) |
| Ventas | Quote+QuoteLine, Sale(factura)+SaleLine(venta), SalePayment(tipofactura), Commission | cotizacion, detallecot, factura, venta, tipofactura, comision |
| Caja | CashAccount(cuenta), CashSession(arqueo), PettyCashExpense(gastos/cajachica), OtherIncome(cajaingreso) | cuenta, arqueo, cajachica, gastos, cajaingreso |
| Cierre | PeriodClose(cierremensual), CloseDifference, PeriodLock, ReconciledEntry | cierremensual y afines |

**Mejoras clave de modelo**
- **`StockMovement` (kardex) como fuente de verdad**: todo cambio de stock (compra, venta, ajuste, transferencia, anulación) genera un movimiento; el `Lot.remaining` se mantiene transaccionalmente. Esto habilita el reporte Kardex que hoy está sin implementar.
- Método de salida **configurable por tenant** (FIFO / LIFO / costo promedio); hoy es "lote más reciente primero" fijo.
- Almacén de venta **configurable** (hoy `almacen_id=1` hard-coded) y multi-almacén real.
- **Costeo (landed cost)**: prorrateo de gastos de logística a líneas por criterio (peso/valor/cantidad) y por tenant, con tipo de cambio por lote; calcula costo unitario, margen %, precio con/sin factura y utilidad **en el servidor** (hoy se hace en JS del navegador).
- Ledger simple de caja (`CashMovement`) para que el cierre mensual no tenga que reconstruir movimientos con 6 consultas distintas.
- Cierre mensual: hash encadenado (SHA-256 del cierre anterior + totales) y `PeriodLock` verificado por un guard/trigger en toda escritura con fecha dentro de un periodo cerrado.

---

## 7. Módulos del backend (NestJS) y API

`platform` · `auth` · `tenants` · `users/roles` · `settings` · `contacts` · `catalog` · `purchasing` · `landed-cost` · `inventory` · `sales` · `quotes` · `payments` · `cash` · `period-close` · `reports` · `imports` · `files` · `audit` · `notifications`

Reglas transversales:
- Controllers delgados → servicios de dominio → repositorios Prisma. Casos críticos (finalizar venta/compra/cierre) en **una transacción** `prisma.$transaction` con aislamiento `Serializable` o bloqueo `SELECT … FOR UPDATE` sobre lotes.
- **Idempotencia** (`Idempotency-Key`) en finalizar venta/pago para evitar doble cobro.
- Estados con máquina explícita: `DRAFT → CONFIRMED → CANCELLED`, y validación de transiciones.
- Paginación por cursor, filtros tipados, errores RFC 7807.
- Eventos de dominio (`SaleConfirmed`, `PurchaseReceived`) vía EventEmitter/outbox para auditoría, notificaciones y reportes.

---

## 8. Frontend

- **`apps/web`**: layout con sidebar por módulos habilitados y permisos del usuario; tablas con TanStack Table (filtros, export CSV/Excel, columnas), formularios con validación Zod, POS/venta rápida con búsqueda de productos y pagos mixtos (efectivo/depósito/transferencia/QR/cheque), i18n `es-BO` (formatos `dd/mm/yyyy`, moneda), modo claro/oscuro, responsive.
- **`apps/admin`**: tenants, planes, módulos, usuarios de plataforma, auditoría global, métricas de uso, impersonación auditada.
- Guard de "cambios sin guardar" (equivalente al `swSave` actual).

---

## 9. Migración desde Quismar (MySQL → Postgres)

1. Extraer esquema real con `mysqldump --no-data smv` y validarlo contra §6.
2. Script ETL en `packages/db/etl` (TypeScript): lee MySQL, mapea estados a enums, convierte fechas/decimales, genera UUIDs, asigna todo a un `Tenant` "Quismar".
3. Reconstruir `StockMovement` y saldos de `Lot` desde ventas/entradas históricas; **conciliar** stock y saldos de caja contra el sistema viejo.
4. Contraseñas: forzar reseteo (las actuales están en texto plano; no migrarlas).
5. Ejecución de prueba en staging, comparación de reportes (inventario, ventas, arqueo) y corte con ventana de congelamiento.

---

## 10. Fases y cronograma estimado (equipo de 3–4 devs)

| Fase | Contenido | Duración |
|---|---|---|
| **0. Fundaciones** | Monorepo pnpm/Turbo, CI, scripts de BD local, lint/format, ADRs, plantilla Nest + Next, `@erp/db` con Prisma y roles Postgres | 1–2 sem |
| **1. Núcleo multi-tenant y seguridad** | Tenant context, RLS + extensión Prisma + test de aislamiento, auth (argon2, JWT/refresh, 2FA), RBAC, auditoría, consola admin (alta/suspensión de tenants, módulos) | 3–4 sem |
| **2. Configuración y maestros** | Empresa, sucursales/almacenes, monedas/tipo de cambio, gestión, secuencias, clientes, proveedores, catálogo, importación Excel de productos (job) | 3 sem |
| **3. Compras, logística e inventario** | Órdenes de compra, pagos, landed cost, lotes, kardex, ajustes, transferencias, stock mínimo | 4–5 sem |
| **4. Ventas** | Cotizaciones, venta/factura con pagos mixtos y crédito, comisiones, anulación, descuento de stock, PDFs (venta, nota de remisión, pago) | 4–5 sem |
| **5. Caja y cierre** | Cuentas, arqueo, gastos, otros ingresos, ledger de caja, cierre mensual con bloqueo/reapertura/auditoría | 3 sem |
| **6. Reportes** | Ingresos, inventarios, kardex, stock mínimo, clientes, arqueo, registro y resumen de ventas, gastos; exportación PDF/Excel | 3 sem |
| **7. Endurecimiento** | Pentest interno, pruebas de carga, backups/PITR, observabilidad, límites por plan, documentación | 2–3 sem |
| **8. Migración y salida** | ETL, conciliación, capacitación, corte | 2–3 sem |

Total aproximado: **25–30 semanas** (MVP vendible con fases 0–4 en ~15 semanas). Pendientes opcionales posteriores: usuarios/permisos finos avanzados, plan de cuentas contable, facturación electrónica, app móvil/POS offline, balance/flujo de fondos.

---

## 11. Calidad y definición de terminado

- Cobertura mínima en dominio crítico (inventario, ventas, cierre) ≥ 80 %; pruebas de **aislamiento entre tenants** en CI (un tenant jamás ve datos de otro, ni vía API ni vía SQL directo con el rol de la app).
- Pruebas de concurrencia: dos ventas simultáneas sobre el mismo lote no generan stock negativo.
- Migraciones Prisma revisadas en PR (`prisma migrate diff`), sin `db push` en entornos compartidos.
- Cada PR: lint + typecheck + tests + `pnpm audit` verdes.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Fuga entre tenants por olvido de filtro | RLS forzado + rol sin BYPASSRLS + tests automáticos por tabla |
| Prisma y RLS (pool de conexiones) | `set_config(..., true)` dentro de cada transacción; nunca a nivel de sesión |
| Inconsistencia de stock/caja | Kardex/ledger transaccional, locks por lote, conciliaciones periódicas |
| Migración de datos sucios (estados texto libre, sin FKs) | ETL con validaciones y reporte de rechazados; conciliación antes del corte |
| Alcance creciente | MVP por fases 0–4; backlog explícito para lo no implementado en el legado |
| Rendimiento con muchos tenants | Índices `(tenantId, …)`, particionado de `StockMovement`/`AuditLog` por fecha, réplicas de lectura para reportes |

---

## 13. Primeros pasos concretos

```bash
corepack enable && corepack prepare pnpm@latest --activate
mkdir erp && cd erp && pnpm init
# pnpm-workspace.yaml: packages: ['apps/*','packages/*']
pnpm add -Dw typescript turbo eslint prettier
pnpm --filter @erp/db add prisma @prisma/client
# Postgres y Redis locales (sin Docker): C:/Users/Gudnar/devtools/start-dev-services.ps1
psql -U postgres -h localhost -f infra/setup-db.sql
pnpm --filter @erp/db prisma migrate dev
```

Primer hito demostrable: **crear dos tenants, cada uno con su admin, y comprobar con un test que ninguno puede leer los datos del otro**, antes de construir cualquier módulo de negocio.
