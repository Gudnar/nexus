# ADR-005: Caja, sesiones, arqueos y política de diferencias

- **Estado:** Propuesto
- **Fecha:** 2026-11-22
- **Referencias:** planificación v2.1 §13, §14, §20.10, §22.3, §28.4

## Contexto

Cada sucursal tiene varias cajas con turnos, medios de pago mixtos,
arqueos y diferencias. El cierre debe ser inmutable y las correcciones
deben hacerse con movimientos compensatorios. Hay riesgo de concurrencia
(cierre mientras entran ventas) y de manipulación de diferencias.

## Decisión

1. **Una caja pertenece a una sola sucursal** y no se comparte entre
   sucursales.
2. **Una sesión abierta por caja.** Un índice único parcial lo impone:
   `UNIQUE (tenant_id, cash_register_id) WHERE status = 'OPEN'`. El modo
   de sesión compartida (`allowSharedSession`) viene deshabilitado y
   requiere habilitación explícita por caja.
3. **Responsable y participantes.** La sesión tiene un usuario
   responsable; otros usuarios operan solo si figuran en
   `CashSessionParticipant`. Cada movimiento registra el usuario.
4. **`CashMovement` es un libro inmutable.** Cada movimiento referencia
   sesión, medio de pago y origen (`sourceType`, `sourceId`). Las
   correcciones se hacen con `CashMovementReversal` y un movimiento
   compensatorio.
5. **Efectivo y otros medios se concilian por separado.** Efectivo
   esperado: `saldoInicial + ingresosEfectivo - egresosEfectivo -
   retiros ± reversos`. QR, tarjeta y transferencia se concilian contra
   sus propios movimientos o extractos.
6. **Apertura** registra monto inicial y denominaciones
   (`CashSessionOpening`).
7. **Estados de sesión:** `OPEN → CLOSING → CLOSED`, y `REOPENED` solo
   por workflow. Al pasar a `CLOSING` la sesión rechaza nuevos
   movimientos; el cambio se hace con bloqueo de fila para que una venta
   concurrente no entre después.
8. **Arqueo** por denominación (`CashCount`, `CashCountDenomination`),
   con monto esperado calculado por el sistema, no digitado.
9. **Diferencias** (`CashDifference`):
   - requieren justificación;
   - dentro de la tolerancia configurable del tenant, se registran sin
     aprobación;
   - sobre la tolerancia, requieren aprobación mediante el motor de
     aprobaciones (evento `CashDifferenceDetected`);
   - el cajero no puede aprobar su propia diferencia.
10. **Cierre inmutable.** `CashClosing` guarda un snapshot de totales por
    medio de pago, conteo y diferencia. Después no se modifican
    movimientos de esa sesión.
11. **Reapertura** requiere permiso `cash.reopen_session` y aprobación;
    deja rastro en auditoría y mantiene el cierre original.
12. **Ciclo de venta y caja:** una venta con pago en efectivo debe tener
    `cashSessionId` de una sesión abierta de su sucursal; la validación
    ocurre dentro de la transacción de confirmación (plan §22.1).
13. **Transferencias entre cajas y bóveda** (`CashTransfer`) generan
    movimientos de salida y entrada vinculados.
14. **El cierre de caja no es el cierre mensual** (plan §19); son
    procesos independientes.

## Alternativas consideradas

- **Sesión compartida por defecto:** pierde la responsabilidad por
  usuario y complica el arqueo.
- **Permitir editar movimientos antes del cierre:** facilita errores y
  fraude; se prefiere compensar con reversos.
- **Aprobar toda diferencia:** carga operativa innecesaria; se usa una
  tolerancia configurable.

## Consecuencias

- (+) Trazabilidad completa por usuario, sesión y medio de pago.
- (+) Se evita la doble sesión y las ventas después del cierre.
- (−) Corregir errores exige reversos, lo que requiere formación del
  personal.
- (−) El bloqueo al pasar a `CLOSING` puede demorar ventas simultáneas
  unos instantes; se mide en pruebas.

## Pruebas obligatorias

- Dos aperturas simultáneas de la misma caja: solo una prospera.
- Venta concurrente con cierre de caja: ninguna entra tras `CLOSING`.
- Arqueo con diferencias dentro y fuera de tolerancia.
- Autoaprobación de diferencia rechazada.
- Reapertura con aprobación y auditoría.
- Reportes por usuario, caja, sucursal y consolidado.
