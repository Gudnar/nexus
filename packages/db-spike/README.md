# Spike Fase 0 — Prisma + RLS + FKs compuestas (ADR-001)

Paquete aislado: usa su propia base `erp_spike` y sus propios roles
(`spike_migrator`, `spike_app`). No toca `@erp/db` ni la base `erp`.

## Ejecutar

```bash
# 1. Crear roles, base, schema, RLS y grants (requiere superusuario)
SPIKE_ADMIN_URL="postgresql://postgres:<clave>@localhost:5432/postgres" \
  pnpm --filter @erp/db-spike db:setup

# 2. Generar el cliente y correr las pruebas
pnpm --filter @erp/db-spike generate
pnpm --filter @erp/db-spike test

# 3. Medir el sobrecoste de la transacción con contexto
pnpm --filter @erp/db-spike bench
```

Variables opcionales: `SPIKE_APP_URL`, `SPIKE_MIGRATOR_URL`.

## Qué valida (criterio de salida del ADR-001)

| Punto del ADR | Prueba |
|---|---|
| Rol sin BYPASSRLS | `rol de aplicación no es superusuario…` |
| RLS forzado + política + `tenant_id NOT NULL` + trigger | `toda tabla con tenant_id…` (recorre el catálogo) |
| Sin contexto no hay filas | `sin contexto no se ve ninguna fila` |
| Lectura/escritura aislada (Prisma y SQL directo) | bloque `aislamiento…` |
| `tenant_id` inmutable | `tenant_id es inmutable…` |
| FKs compuestas, incluida la nullable | bloque `FKs compuestas` |
| Contexto no se filtra por el pool | bloque `pool de conexiones…` (1 conexión y 150 concurrentes) |
| Auditoría append-only | bloque `auditoría append-only` |
| Contexto en jobs | bloque `contexto en jobs/workers` |
| Costo de la transacción por request | `bench` |

## Decisión del spike

- **Pasa todo y el sobrecoste es aceptable:** ADR-001 pasa a "Aceptado" y se
  mantiene Prisma.
- **Falla FK compuesta nullable o el costo no es aceptable:** se evalúa
  Kysely para rutas críticas (alternativa del ADR-001).

## Fuera del alcance de este spike

- Restricción por sucursal (`UserBranchAccess`): es validación de dominio.
- Workers reales con BullMQ: aquí solo se prueba el contrato del contexto.
