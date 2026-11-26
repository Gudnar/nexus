-- Un movimiento solo puede revertirse una vez (la base lo garantiza aunque dos usuarios lo intenten a la vez).
CREATE UNIQUE INDEX stock_movement_reversal_unique ON stock_movement (tenant_id, reversal_of_id) WHERE reversal_of_id IS NOT NULL;
