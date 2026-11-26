"use client";

import { CalendarDays } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { days: 7, label: "Últimos 7 días" },
  { days: 30, label: "Últimos 30 días" },
  { days: 90, label: "Últimos 90 días" },
];

/** El filtro vive en la URL (?days=) para poder compartir y recargar la vista. */
export function DateRangeSelect({ value }: { value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="relative flex items-center">
      <span className="sr-only">Periodo</span>
      <CalendarDays className="pointer-events-none absolute left-3 size-4 text-ink-2" aria-hidden />
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          next.set("days", e.target.value);
          router.push(`${pathname}?${next}`);
        }}
        className="h-10 appearance-none rounded-lg border border-line-strong bg-surface pl-9 pr-8 text-[13px] text-body hover:bg-surface-muted"
      >
        {OPTIONS.map((o) => (
          <option key={o.days} value={o.days}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
