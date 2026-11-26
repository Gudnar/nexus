# ADR-002: Modelo fiscal en capas y separación entre precio e impuesto

- **Estado:** Propuesto
- **Fecha:** 2026-11-22
- **Referencias:** planificación v2.1 §8, §20.2, §20.8, §33

## Contexto

Una empresa puede vender con precios `WITH_TAX` o `WITHOUT_TAX`, según
el cliente o la operación. El borrador original definía dos conjuntos de
entidades fiscales: `TaxProfile`/`TaxRule` y `TaxCode`/`TaxRate`. Se
decidió implementar ambos. La estrategia de facturación del SIN
(ADR-003) aún no está cerrada, por lo que el modelo no debe bloquear
ninguna opción.

## Decisión

1. **El precio comercial y el cálculo fiscal son motores separados.**
   `priceMode` indica cómo se interpreta el precio; los tributos reales
   los determina el motor fiscal.
2. **Cuatro capas, todas implementadas:**

   | Capa | Entidades | Responsabilidad |
   |------|-----------|-----------------|
   | 1 | `TaxCode`, `TaxRate` | Catálogo de tributos y tasa por vigencia |
   | 2 | `TaxProfile`, `TaxRule` | Qué `TaxCode` aplica según producto, cliente y operación |
   | 3 | `TaxCalculation`, `TaxCalculationLine` | Snapshot inmutable por documento |
   | 4 | `TaxDocumentReference`, `FiscalDocument` | Documento fiscal externo o propio |

3. **`TaxRule` referencia `taxCodeId` y no guarda tasa.** La tasa se
   resuelve en `TaxRate` por fecha del documento. Evita duplicar
   valores y permite cambiar tasas sin tocar reglas.
4. **Flujo de cálculo (servidor):**
   1. resolver perfiles fiscales de producto, cliente y operación;
   2. seleccionar `TaxRule` vigentes ordenadas por `priority`;
   3. obtener la tasa vigente de cada `TaxCode`;
   4. aplicar `priceMode`: en `WITH_TAX` desglosar la base desde el
      precio; en `WITHOUT_TAX` calcular el tributo sobre el precio;
   5. aplicar redondeo por moneda y documento;
   6. persistir `TaxCalculation` con las reglas y tasas usadas.
5. **Los documentos guardan snapshot completo** (base, tributos
   desglosados, reglas aplicadas). Cambios posteriores en reglas o
   tasas no alteran documentos históricos.
6. **Cambiar `priceMode` en una venta** requiere permiso y recalcula las
   líneas de forma explícita.
7. **Toda regla, tasa y perfil** tiene vigencia, historial de cambios y
   auditoría; el cálculo es determinista dado el conjunto de reglas.
8. **Estado fiscal independiente** del estado comercial y del de pago:
   `NOT_REQUIRED | PENDING | ISSUED | REJECTED | VOIDED`.
9. **El emisor fiscal es un adaptador** en `packages/integrations`
   detrás de una interfaz común (emitir, anular, consultar, reintentar).
   Sin emisor validado, ningún documento se presenta como factura
   oficial.
10. **Los valores fiscales iniciales** (tributos, tasas, perfiles) no
    se fijan en este ADR; se cargan como seed validado por el
    responsable fiscal del negocio.

## Alternativas consideradas

- **Un único modelo (`TaxRule` con tasa propia):** más simple, pero
  duplica tasas y complica cambios de vigencia.
- **Un único modelo (`TaxCode`/`TaxRate` sin perfiles):** no expresa
  exenciones ni reglas por cliente o producto.
- **Calcular impuestos como diferencia entre dos listas de precios:**
  rechazada; la diferencia entre precios no es una tasa tributaria.

## Consecuencias

- (+) Reglas y tasas cambian de forma independiente y con vigencia.
- (+) El modelo soporta tanto emisión propia como facturador externo.
- (+) Los documentos históricos permanecen estables.
- (−) Más entidades y más pruebas: hay que cubrir combinaciones de
  perfil, modalidad, exención y redondeo.
- (−) La resolución de reglas requiere criterios claros de prioridad y
  desempate, que se documentan en la implementación del motor.

## Preguntas abiertas (ADR-003)

- ¿El ERP emite factura electrónica o se integra con un facturador
  externo?
- ¿Qué modalidades de emisión y contingencia deben soportarse?
- ¿Qué tributos y perfiles iniciales se cargan?
- ¿Se requieren libros de ventas y de compras?
