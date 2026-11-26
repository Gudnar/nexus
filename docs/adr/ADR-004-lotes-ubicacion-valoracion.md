# ADR-004: Lotes, ubicación de stock y valoración

- **Estado:** Propuesto
- **Fecha:** 2026-11-22
- **Referencias:** planificación v2.1 §10, §10.4, §20.6, §22, §28.3

## Contexto

La versión 2.0 tenía un conflicto de modelo: `Lot.currentWarehouseId`
daba un único almacén por lote, mientras `StockBalance` es por almacén y
lote y las transferencias mueven lotes entre almacenes y sucursales. Además,
FIFO, LIFO y promedio configurables no encajan por igual con la
asignación de lote por línea de venta.

## Decisión

1. **`Lot` es identidad, no ubicación.** Guarda producto, origen,
   proveedor, fechas, costo de adquisición y gastos asignados. Su
   `receivedWarehouseId` es inmutable.
2. **La ubicación vive en `StockBalance`** (almacén + producto + lote).
   Una transferencia genera una salida en el origen y una entrada en el
   destino con el mismo `lotId`; el lote no se duplica ni se reubica.
3. **`StockMovement` es la fuente de verdad** (inmutable). `StockBalance`
   es una proyección transaccional con columna `version`.
4. **La cantidad disponible no se guarda en `Lot`.** Se deriva de
   `StockBalance`.
5. **Valoración por método:**
   - **FIFO y LIFO:** consumen capas de costo por lote.
   - **Promedio ponderado:** se calcula por almacén y producto en
     `InventoryValuation`; no es por lote.
6. **La asignación de lote se conserva siempre** (`SaleLineLotAllocation`).
   Con costo promedio, `unitCostSnapshot` guarda el promedio vigente y
   el lote es referencia física para trazabilidad.
7. **Un método de valoración por tenant y producto, con vigencia.** El
   cambio aplica hacia adelante y genera un documento de revaluación; no
   reescribe movimientos previos.
8. **Stock negativo deshabilitado por defecto.** Habilitarlo es una
   política explícita por tenant o almacén.
9. **Reservas** (`StockReservation`) con expiración y liberación
   automática; descuentan de `availableQty`, no de `physicalQty`.
10. **Transferencias:** estados `DRAFT`, `DISPATCHED`, `IN_TRANSIT`,
    `RECEIVED`, `CANCELLED`. La mercadería en tránsito se modela con un
    almacén lógico de tránsito por tenant, para no perder el stock entre
    la salida y la recepción.
11. **Concurrencia:** bloqueo de filas de `StockBalance` en orden estable
    (por almacén, producto y lote), nivel `Serializable` o locks
    explícitos y reintentos controlados ante conflicto. La validación
    de stock ocurre dentro de la transacción.
12. **Correcciones** mediante movimientos inversos o ajustes aprobados;
    nunca se borra un movimiento.
13. **Conciliación diaria** de `StockBalance` contra la suma de
    `StockMovement`, y de `InventoryValuation` contra movimientos, con
    alerta si hay diferencias.
14. **Selección de lote** automática por la política de valoración;
    la selección manual requiere permiso.

## Alternativas consideradas

- **Lote atado a un almacén (modelo 2.0):** obliga a duplicar o clonar
  lotes en cada transferencia y rompe la trazabilidad.
- **Costo por lote para todos los métodos:** el promedio ponderado
  perdería su sentido.
- **Eliminar el promedio:** simplifica, pero el negocio lo pidió como
  opción configurable.

## Consecuencias

- (+) Un lote conserva su historia y costo a través de transferencias.
- (+) Dos modelos de costo coexisten sin ambigüedad.
- (−) Valoración promedio y por capas implican dos caminos de cálculo
  y más pruebas.
- (−) El cambio de método requiere un proceso de revaluación auditado.
- (−) El bloqueo ordenado de filas limita el paralelismo sobre un mismo
  lote; se mide en pruebas de carga.

## Pruebas obligatorias

- Ventas concurrentes sobre un mismo lote sin stock negativo.
- Transferencia completa, parcial y cancelada en tránsito.
- Reversos de venta y de compra con costo preservado.
- Cambio de método de valoración con revaluación.
- Conciliación de balances contra movimientos.
