import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ADMIN_URL, MIGRATOR_URL } from "../src/config";

const root = path.resolve(__dirname, "..");
const sql = (f: string) => path.join(root, "sql", f);

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

function psql(url: string, file: string): void {
  const r = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-f", file, url], {
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error(`psql falló con ${file}`);
}

if (!ADMIN_URL) {
  console.error(
    "Falta SPIKE_ADMIN_URL (superusuario). Ejemplo:\n" +
      '  SPIKE_ADMIN_URL="postgresql://postgres:<clave>@localhost:5432/postgres" pnpm --filter @erp/db-spike setup',
  );
  process.exit(1);
}

console.log("1/4 roles y base erp_spike");
psql(withDb(ADMIN_URL, "postgres"), sql("00-roles.sql"));

console.log("2/4 reset del schema public");
psql(withDb(ADMIN_URL, "erp_spike"), sql("10-reset-schema.sql"));

console.log("3/4 DDL generado desde schema.prisma");
const prismaBin = require.resolve("prisma/build/index.js");
const diff = spawnSync(
  process.execPath,
  [prismaBin, "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
  { cwd: root, encoding: "utf8" },
);
if (diff.status !== 0) {
  console.error(diff.stderr);
  throw new Error("prisma migrate diff falló");
}
mkdirSync(path.join(root, "sql", "generated"), { recursive: true });
const ddl = path.join(root, "sql", "generated", "schema.sql");
writeFileSync(ddl, diff.stdout);
psql(MIGRATOR_URL, ddl);

console.log("4/4 RLS, triggers y grants");
psql(MIGRATOR_URL, sql("20-rls.sql"));

console.log("Listo. Ejecuta: pnpm --filter @erp/db-spike test");
