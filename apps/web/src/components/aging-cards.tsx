import { money } from "@/components/field";
import { Card } from "@/components/ui";

const LABELS: [string, string][] = [["current", "Por vencer"], ["d1_30", "1 a 30 días"], ["d31_60", "31 a 60 días"], ["d61_90", "61 a 90 días"], ["d90plus", "Más de 90 días"]];

/** Resumen de antigüedad de saldos: cuánto hay por vencer y cuánto vencido, por tramo. */
export function AgingCards({ totals }: { totals: Record<string, string> }) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="aging">
      <Card className="lg:col-span-1"><p className="text-xs text-ink-2">Total pendiente</p><p className="mt-1 text-lg font-semibold tabular-nums text-ink" data-testid="aging-total">{money(totals.outstanding ?? "0")}</p></Card>
      {LABELS.map(([k, label]) => (
        <Card key={k}><p className="text-xs text-ink-2">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${k === "current" ? "text-ink" : Number(totals[k]) > 0 ? "text-warning" : "text-ink-3"}`} data-testid={`aging-${k}`}>{money(totals[k] ?? "0")}</p></Card>
      ))}
    </div>
  );
}
