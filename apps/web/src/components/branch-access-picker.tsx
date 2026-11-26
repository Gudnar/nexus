"use client";

import type { BranchDetail } from "@erp/contracts";
import { ACCESS_LABELS } from "@/lib/labels";
import { inputCls } from "@/components/ui";

export type AccessLevel = keyof typeof ACCESS_LABELS;
export interface AccessValue {
  allBranches: boolean;
  /** branchId → nivel (solo las sucursales marcadas). */
  branches: Record<string, AccessLevel>;
}

/** Elegir "todas las sucursales" o sucursales concretas, cada una con su nivel de acceso. */
export function BranchAccessPicker({
  branches, value, onChange, canGrantAll,
}: { branches: BranchDetail[]; value: AccessValue; onChange: (v: AccessValue) => void; canGrantAll: boolean }) {
  const active = branches.filter((b) => b.status === "ACTIVE" || value.branches[b.id]);

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1.5 text-xs font-medium text-ink-2">Acceso a sucursales</legend>
      {canGrantAll && (
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-body">
          <input type="checkbox" className="size-4 accent-brand" checked={value.allBranches}
            onChange={(e) => onChange({ ...value, allBranches: e.target.checked })} />
          Todas las sucursales (incluidas las futuras)
        </label>
      )}
      {!value.allBranches && (
        <ul className="grid gap-2 rounded-lg border border-line p-3">
          {active.map((b) => {
            const level = value.branches[b.id];
            return (
              <li key={b.id} className="flex items-center gap-3 text-[13px]">
                <label className="flex flex-1 cursor-pointer items-center gap-2.5">
                  <input type="checkbox" className="size-4 accent-brand" checked={!!level}
                    onChange={(e) => {
                      const next = { ...value.branches };
                      if (e.target.checked) next[b.id] = "OPERATE";
                      else delete next[b.id];
                      onChange({ ...value, branches: next });
                    }} />
                  <span className="shrink-0 font-medium text-ink">{b.code}</span>
                  <span className="min-w-0 truncate whitespace-nowrap text-ink-2">{b.name}</span>
                </label>
                {level && (
                  <select aria-label={`Nivel en ${b.code}`} className={`${inputCls} h-8 w-[130px]`} value={level}
                    onChange={(e) => onChange({ ...value, branches: { ...value.branches, [b.id]: e.target.value as AccessLevel } })}>
                    {(Object.keys(ACCESS_LABELS) as AccessLevel[]).map((l) => <option key={l} value={l}>{ACCESS_LABELS[l]}</option>)}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

export const toAccessPayload = (v: AccessValue) => ({
  allBranches: v.allBranches,
  branches: v.allBranches ? [] : Object.entries(v.branches).map(([branchId, accessLevel]) => ({ branchId, accessLevel })),
});
