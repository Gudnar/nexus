import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-surface p-5 shadow-card ${className}`}>{children}</section>;
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title, description, actions, children,
}: { title: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[24px] font-[650] leading-[1.25] text-ink">{title}</h1>
        {description && <p className="mt-1 text-ink-2">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function MetricCard({
  label, value, hint, icon: Icon, unavailable,
}: { label: string; value: string; hint?: string; icon: LucideIcon; unavailable?: boolean }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <p className="text-ink-2">{label}</p>
        <span className="grid size-9 place-items-center rounded-md bg-brand-soft text-brand">
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </div>
      <p className={`mt-3 text-[27px] font-[650] leading-tight ${unavailable ? "text-ink-3" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </Card>
  );
}

const TONES = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-neutral-soft text-ink-2",
} as const;

export function StatusBadge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>
  );
}

export function EmptyState({
  icon: Icon, title, description,
}: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-neutral-soft text-ink-3">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-ink-2">{description}</p>}
    </div>
  );
}

export function ProgressList({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-4">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1.5 flex items-center justify-between text-[13px]">
            <span className="text-body">{i.label}</span>
            <span className="font-medium text-ink">{i.value}</span>
          </div>
          <div className="h-1.5 rounded-full bg-neutral-soft" role="presentation">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(4, (i.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Estilos de formularios y botones de la aplicación (tokens del JSON de diseño). */
export const inputCls =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
export const btnPrimary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60";
export const btnSecondary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-[13px] font-medium text-body hover:bg-surface-muted disabled:opacity-60";
export const btnDanger =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-danger px-4 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
