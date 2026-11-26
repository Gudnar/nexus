import { withTenant } from "../src/tenant-context";
import { app, closeAll, seedWorld } from "../tests/helpers";

const N = 500;

async function time(label: string, fn: () => Promise<unknown>) {
  await fn(); // calentamiento
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / N;
  const p95 = samples[Math.floor(N * 0.95)]!;
  console.log(`${label.padEnd(34)} media ${mean.toFixed(2)} ms   p95 ${p95.toFixed(2)} ms`);
  return mean;
}

(async () => {
  const w = await seedWorld();
  console.log(`Consulta: branch.findMany() — ${N} iteraciones secuenciales\n`);

  const plain = await time("sin transacción (sin contexto)", () => app.branch.findMany());
  const tx = await time("transacción vacía", () => app.$transaction((t) => t.branch.findMany()));
  const ctx = await time("transacción + set_config (ADR-001)", () =>
    withTenant(app, w.tenantA, (t) => t.branch.findMany()),
  );

  console.log(`\nSobrecoste del contexto frente a la transacción vacía: +${(ctx - tx).toFixed(2)} ms/request`);
  console.log(`Sobrecoste total frente a la consulta simple:          +${(ctx - plain).toFixed(2)} ms/request`);
  await closeAll();
})();
