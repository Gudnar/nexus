import { assertUuid, type Tx } from "./context";

/**
 * Siguiente número de una secuencia, sin huecos (ADR-006).
 * `UPDATE ... RETURNING` toma el bloqueo de fila: las transacciones concurrentes sobre la
 * misma secuencia se serializan, y si la transacción de negocio revierte, el número no se
 * consume. Llamar al FINAL de la transacción de confirmación para acortar el bloqueo.
 * Debe ejecutarse dentro de `withTenant`.
 */
export async function nextSequenceNumber(
  tx: Tx,
  documentType: string,
  branchId: string | null = null,
): Promise<{ value: bigint; formatted: string }> {
  if (branchId !== null) assertUuid(branchId, "branchId");
  const rows = await tx.$queryRaw<{ current_value: bigint; prefix: string; padding: number }[]>`
    UPDATE sequence
       SET current_value = current_value + 1
     WHERE document_type = ${documentType}
       AND branch_id IS NOT DISTINCT FROM ${branchId}::uuid
    RETURNING current_value, prefix, padding`;
  const row = rows[0];
  if (!row) throw new Error(`Secuencia no configurada: ${documentType}`);
  const value = BigInt(row.current_value);
  return { value, formatted: `${row.prefix}${value.toString().padStart(row.padding, "0")}` };
}
