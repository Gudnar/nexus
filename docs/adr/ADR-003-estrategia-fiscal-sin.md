# ADR-003: Estrategia fiscal y facturación electrónica SIN (Bolivia)

- **Estado:** Borrador, pendiente de decisión del negocio
- **Fecha:** 2026-11-22
- **Referencias:** planificación v2.1 §0.3, §6.3, §20.8, §33; ADR-002

## Contexto

La planificación deja fuera de alcance inicial la facturación
electrónica oficial del SIN. En Bolivia una venta de mostrador
normalmente requiere factura, por lo que esta decisión afecta al modelo
de ventas, a la anulación y a la oferta comercial del producto. La
normativa concreta (modalidades, contingencia, anulación, libros) no se
asume en este documento y debe validarse con el responsable fiscal.

## Decisión ya tomada (no depende del negocio)

El modelo no debe bloquear ninguna opción:

1. Las ventas usan `TaxCalculation` y `FiscalDocument` (ADR-002) desde la
   Fase 5, aunque no exista emisor activo.
2. El emisor es un adaptador en `packages/integrations` con interfaz
   común: `emitir`, `anular`, `consultarEstado`, `reintentar`.
3. El estado fiscal es una dimensión propia:
   `NOT_REQUIRED | PENDING | ISSUED | REJECTED | VOIDED`.
4. Anular una venta con documento emitido exige la anulación fiscal, con
   su propio flujo de aprobación (ADR-005 y motor de aprobaciones).
5. La emisión es asíncrona e idempotente: se encola por outbox
   (ADR-006), con reintentos y estado visible al usuario.
6. Sin emisor validado, ningún documento se presenta como factura
   oficial.
7. Las credenciales fiscales viven en `FiscalProviderConfiguration`,
   cifradas y por tenant o sucursal.

## Decisión pendiente

Elegir la vía de emisión antes de cerrar la Fase 0:

| Opción | Descripción | Ventajas | Riesgos |
|--------|-------------|----------|---------|
| A | Emisión propia integrada al SIN | Control total, sin costo por documento a terceros | Alta carga normativa y de certificación; mantenimiento ante cambios |
| B | Integración con facturador externo autorizado | Menor carga normativa, salida más rápida | Dependencia y costo del proveedor; límites de su API |
| C | Sin emisión en la primera versión; solo documento comercial | Menor alcance inicial | El producto no sirve a clientes que deben facturar en mostrador |

**Recomendación técnica:** B para la primera salida productiva, con el
adaptador diseñado para sustituirlo por A si el negocio lo requiere. La
recomendación es solo técnica; la elección depende de la normativa y del
modelo comercial.

## Preguntas que debe responder el negocio

1. ¿Los clientes objetivo están obligados a facturar en cada venta?
2. ¿Qué modalidades de emisión y contingencia debe soportar el sistema?
3. ¿Qué tributos y perfiles fiscales iniciales se cargan como seed?
4. ¿Se requieren libros de ventas y de compras?
5. ¿Qué proveedor o proveedores se evalúan para la opción B?
6. ¿Quién es el responsable fiscal que valida las reglas?

## Consecuencias

- (+) El modelo de ventas ya está preparado para cualquier opción.
- (+) Aislar el emisor en un adaptador limita el impacto de cambios
  normativos o de proveedor.
- (−) Sin respuesta del negocio, el alcance de la Fase 5 y la oferta
  comercial siguen abiertos.
- (−) La opción C debe comunicarse con claridad para no inducir a error
  sobre el valor fiscal de los documentos.
