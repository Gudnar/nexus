import { createDb, type Db } from "@erp/db";
import { AppConfig } from "./config";

export const DB = Symbol("DB");
export const PLATFORM_DB = Symbol("PLATFORM_DB");
export const WORKER_DB = Symbol("WORKER_DB");
export type { Db };

/** Cliente con el rol de aplicación (`erp_app`, sin BYPASSRLS). */
export const dbProvider = {
  provide: DB,
  inject: [AppConfig],
  useFactory: (config: AppConfig): Db => createDb(config.databaseUrl),
};

/**
 * Cliente con el rol de plataforma (`erp_platform`, también sujeto a RLS). Solo lo usan el
 * registro autoservicio y la consola del administrador global. null si no está configurado.
 */
export const platformDbProvider = {
  provide: PLATFORM_DB,
  inject: [AppConfig],
  useFactory: (config: AppConfig): Db | null =>
    config.platformDatabaseUrl ? createDb(config.platformDatabaseUrl) : null,
};

/** Cliente con el rol de worker (`erp_worker`): solo lee/actualiza outbox_event. null si no está configurado. */
export const workerDbProvider = {
  provide: WORKER_DB,
  inject: [AppConfig],
  useFactory: (config: AppConfig): Db | null => (config.workerDatabaseUrl ? createDb(config.workerDatabaseUrl) : null),
};
