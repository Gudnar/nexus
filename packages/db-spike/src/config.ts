export const APP_URL =
  process.env.SPIKE_APP_URL ?? "postgresql://spike_app:spike_app_pass@localhost:5432/erp_spike";

export const MIGRATOR_URL =
  process.env.SPIKE_MIGRATOR_URL ??
  "postgresql://spike_migrator:spike_migrator_pass@localhost:5432/erp_spike";

/** Solo para `setup`: superusuario con permiso de crear roles y bases. */
export const ADMIN_URL = process.env.SPIKE_ADMIN_URL;
