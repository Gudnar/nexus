# ADR-001: Aislamiento multi-tenant con RLS y contexto de tenant/sucursal

- **Estado:** Aceptado (spike validado el 2026-11-22; ver "Resultado del spike")
- **Fecha:** 2026-11-22
- **Referencias:** planificación v2.1 §4.3, §4.4, §22.4, §35

## Contexto

El ERP es SaaS multi-tenant con base y esquema compartidos. Un error de
aislamiento expone datos de una empresa a otra, por lo que no puede
depender solo de filtros en la aplicación. Además, una empresa tiene
varias sucursales dentro del mismo tenant, y el acceso por sucursal debe
validarse en backend.

Prisma no sustituye las políticas de PostgreSQL, tiene soporte limitado
para FKs compuestas con columnas nullable y trabaja con pool de
conexiones, lo que obliga a cuidar dónde se fija el contexto.

## Decisión

1. **Base y esquema compartidos** con `tenant_id UUID NOT NULL` en toda
   tabla de negocio.
2. **RLS habilitado y forzado** (`ENABLE` y `FORCE ROW LEVEL SECURITY`)
   en todas las tablas tenant-scoped, con política `USING` y
   `WITH CHECK` sobre `current_setting('app.tenant_id', true)`.
3. **Roles de base separados:**
   - `erp_app`: usado por API y workers; sin `BYPASSRLS` y sin
     privilegios DDL.
   - `erp_migrator`: usado solo por migraciones.
   - `erp_platform`: acceso a tablas globales de plataforma; no se usa
     en rutas de tenant.
4. **Contexto por transacción.** Cada request, job o evento abre una
   transacción y ejecuta `set_config('app.tenant_id', $1, true)` antes de
   cualquier consulta. Nunca se fija a nivel de sesión de conexión, para
   no filtrar contexto entre requests del pool.
5. **El `tenantId` nunca viene del cliente.** Se resuelve desde el
   dominio o subdominio, y desde un JWT/sesión validados.
6. **Integridad referencial entre tenants:** cada tabla define
   `UNIQUE (tenant_id, id)` y las FKs son compuestas
   `(tenant_id, x_id)`. Para recursos con ubicación se añade
   `branch_id` donde la relación lo requiera.
7. **`tenant_id` inmutable**, forzado con trigger `BEFORE UPDATE`.
8. **Contexto de sucursal (`BranchContext`).** Se resuelve por request y
   se valida contra `UserBranchAccess`. `Todas las sucursales` solo se
   admite en consultas de lectura con permiso explícito. La sucursal es
   una validación de dominio y de aplicación; RLS por sucursal no se
   aplica en la base, salvo que el spike demuestre que es viable.
9. **Identificadores UUID v7 generados en la aplicación** (PostgreSQL 16
   no los genera de forma nativa).
10. **Contexto asíncrono.** Jobs de BullMQ, eventos de outbox,
    WebSocket, exportaciones y cachés transportan `tenantId` (y
    `branchId` cuando aplique) y lo restablecen antes de operar. Las
    claves de caché incluyen el tenant.
11. **Migraciones:** RLS, políticas, triggers y FKs compuestas se
    escriben en SQL manual dentro de `packages/db`, junto con las
    migraciones de Prisma.
12. **Pruebas obligatorias:** una prueba automática recorre el catálogo
    de tablas y verifica que cada tabla con `tenant_id` tiene RLS
    forzado y política; además, pruebas de lectura y escritura cruzada
    entre tenants con Prisma, SQL directo y workers.

## Spike previo (Fase 0)

Antes de congelar el schema se valida: FKs compuestas con nullable,
transacción interactiva por request con pool, rendimiento de esa
transacción y ejecución con el rol `erp_app`. **Criterio de salida:**
las pruebas del punto 12 pasan sobre un prototipo con dos tenants.

## Alternativas consideradas

- **Filtro solo en aplicación (extensión Prisma):** rechazada; un olvido
  expone datos y no hay última barrera.
- **Esquema por tenant:** mejor aislamiento, pero migraciones y
  operación escalan mal con muchos tenants.
- **Base por tenant:** descartada por costo operativo en el volumen
  esperado.
- **Kysely para rutas críticas:** alternativa si el spike muestra que
  Prisma no sostiene RLS con rendimiento aceptable.

## Consecuencias

- (+) El aislamiento se garantiza aunque falle la capa de aplicación.
- (+) Las FKs compuestas impiden referencias entre tenants.
- (−) Toda operación requiere transacción con contexto, lo que añade un
  viaje a la base y complica scripts y consultas administrativas.
- (−) Parte del schema vive en SQL manual y exige disciplina de
  migraciones.
- (−) Las consultas de plataforma que cruzan tenants usan un rol y una
  ruta separados, con auditoría.

## Resultado del spike (2026-11-22)

Prototipo en `packages/db-spike`, PostgreSQL 16.15, Prisma 6.19.3, Node 24.

- **20 de 20 pruebas pasan:** rol sin `BYPASSRLS`, RLS forzado y política en
  todas las tablas con `tenant_id`, aislamiento de lectura y escritura con
  Prisma y SQL directo, `tenant_id` inmutable, FKs compuestas (incluida la
  nullable, con `ON DELETE RESTRICT`), almacén que no pertenece a la sucursal,
  contexto sin fugas con una conexión y con 150 requests concurrentes sobre un
  pool de 5, auditoría append-only y contrato de contexto en jobs.
- **Sobrecoste del contexto** (500 iteraciones, `findMany` simple, base local):
  transacción + `set_config` +2,9 ms por request frente a una transacción
  vacía y +2,5 ms frente a la consulta sin transacción (media 10,0 ms; p95
  20,1 ms). Aceptable frente al objetivo de p95 menor a 500 ms para confirmar
  una venta.
- **Hallazgos para la implementación:**
  - Prisma genera las FKs compuestas, pero hay que declarar `onDelete: Restrict`
    explícito en las nullables para que no intente `SET NULL` sobre `tenant_id`.
  - RLS, triggers y grants van en SQL manual; la prueba de catálogo detecta
    cualquier tabla nueva sin RLS.
  - Con `FORCE ROW LEVEL SECURITY` el propietario también queda sujeto a RLS:
    los seeds de tablas tenant-scoped también usan `withTenant`.
  - Las comprobaciones de integridad referencial de las FKs no pasan por RLS,
    por eso las FKs compuestas son imprescindibles.
- **No cubierto:** workers reales con BullMQ y la lectura entre tenants del
  dispatcher del outbox (requiere un rol de worker dedicado, ver ADR-006).

**Conclusión:** se mantiene Prisma. No se activa la alternativa con Kysely.
