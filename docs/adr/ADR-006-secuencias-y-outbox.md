# ADR-006: Secuencias de documentos y outbox transaccional

- **Estado:** Propuesto
- **Fecha:** 2026-11-22
- **Referencias:** planificación v2.1 §2.2, §15, §20.2, §20.14, §22, §35.2

## Contexto

Los documentos requieren numeración configurable por tenant, sucursal,
tipo y punto de emisión, idealmente sin huecos. Las notificaciones,
aprobaciones, emisión fiscal e integraciones necesitan eventos
confiables ligados a la transacción de negocio. Ambos temas generan
contención y problemas de consistencia si no se definen desde el inicio.

## Decisión A: secuencias de documentos

1. **`Sequence`** (definida solo en §20.2) se configura por tenant,
   sucursal nullable, tipo de documento y punto de emisión, con prefijo
   y relleno.
2. **Numeración sin huecos para documentos confirmados.** El número se
   asigna dentro de la misma transacción que confirma el documento,
   leyendo y actualizando la fila de `Sequence` con bloqueo
   (`SELECT ... FOR UPDATE`). Si la transacción falla, el número no se
   consume.
3. **Borradores sin número oficial.** Los documentos en `DRAFT` usan un
   identificador interno; el número definitivo se asigna al confirmar.
4. **`SequenceAllocation`** registra cada número asignado y su estado
   (`USED`, `VOIDED`). Un documento anulado conserva su número y este no
   se reutiliza.
5. **Contención.** Una secuencia es un punto serial por diseño. Mitigación:
   secuencias separadas por sucursal y punto de emisión, y transacciones
   de confirmación cortas, con el número asignado al final.
6. **Zona horaria y reinicio.** Las secuencias que reinician por año o
   periodo usan la zona horaria del tenant o sucursal.
7. **Idempotencia.** Una confirmación repetida con la misma
   `Idempotency-Key` devuelve el mismo documento y número.

## Decisión B: outbox transaccional

1. **`OutboxEvent`** se inserta en la misma transacción que el cambio de
   negocio. Incluye tenant, sucursal, actor, agregado, `correlationId`,
   clave de idempotencia y fecha.
2. **Dispatcher en el worker**, con lectura mediante
   `FOR UPDATE SKIP LOCKED`, en lotes pequeños.
3. **Orden:** garantizado por agregado (`aggregateType`, `aggregateId`),
   no global.
4. **Entrega al menos una vez.** Los consumidores son idempotentes y
   deduplican por clave de evento.
5. **Reintentos con backoff exponencial**, límite de intentos y
   dead-letter con alerta; los eventos fallidos se pueden reprocesar con
   permiso y auditoría.
6. **Contexto de tenant.** El dispatcher restablece el contexto del
   evento antes de ejecutar al consumidor (ADR-001).
7. **Payload mínimo:** sin secretos ni datos sensibles innecesarios; el
   consumidor consulta el dato actual cuando lo necesita.
8. **Métricas:** retraso del evento más antiguo, tamaño de cola, tasa de
   fallos y contenido de dead-letter.
9. **Retención:** los eventos procesados se archivan o eliminan tras un
   periodo configurable; la auditoría es un registro aparte y no depende
   del outbox.
10. **Alcance por fases:** versión mínima en la Fase 1 (inserción,
    dispatcher y reintentos) y canales de notificación en la Fase 7.

## Alternativas consideradas

- **Secuencias nativas de PostgreSQL:** rápidas, pero generan huecos al
  revertir y no se configuran por tenant y tipo.
- **Asignar el número al crear el borrador:** produce huecos al
  descartar borradores.
- **Publicar eventos directamente a Redis o a un broker tras el commit:**
  puede perder eventos si el proceso cae entre ambos pasos.
- **CDC (Debezium):** potente, pero añade infraestructura no justificada
  en esta etapa.

## Consecuencias

- (+) Numeración continua y auditable, sin reutilización.
- (+) Ningún evento se pierde por una caída entre commit y publicación.
- (−) La asignación de número serializa las confirmaciones por
  secuencia.
- (−) Entrega al menos una vez exige idempotencia en cada consumidor.
- (−) Más tablas y procesos que operar y monitorear.

## Pruebas obligatorias

- Confirmaciones concurrentes sobre una misma secuencia: sin huecos ni
  duplicados.
- Fallo de transacción: el número no se consume.
- Caída del worker a mitad del despacho: sin pérdida ni duplicado
  efectivo.
- Evento fallido repetidamente: termina en dead-letter con alerta.
- Evento procesado con contexto de tenant correcto.
