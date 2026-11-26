"use client";

import type { PermissionInfo, RoleSummary } from "@erp/contracts";
import { Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { btnDanger, btnPrimary, btnSecondary, Card, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { MODULE_LABELS, PERMISSION_LABELS } from "@/lib/labels";

interface Props {
  roles: RoleSummary[];
  catalog: PermissionInfo[];
  myPermissions: string[];
  canManage: boolean;
}

const NEW = "new";

export function RolesManager({ roles, catalog, myPermissions, canManage }: Props) {
  const router = useRouter();
  const mine = useMemo(() => new Set(myPermissions), [myPermissions]);
  const [selected, setSelected] = useState<string>(roles[0]?.id ?? NEW);
  const role = roles.find((r) => r.id === selected) ?? null;

  const modules = useMemo(() => {
    const m = new Map<string, PermissionInfo[]>();
    for (const p of catalog) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [catalog]);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <Card className="h-fit p-3">
        <ul aria-label="Roles" className="grid gap-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button onClick={() => setSelected(r.id)} aria-current={selected === r.id ? "true" : undefined}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] ${selected === r.id ? "bg-brand-soft font-semibold text-brand-hover" : "text-body hover:bg-surface-muted"}`}>
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 text-xs font-normal text-ink-3">{r.members} {r.members === 1 ? "usuario" : "usuarios"}</span>
              </button>
            </li>
          ))}
        </ul>
        {canManage && (
          <button className={`${btnSecondary} mt-3 w-full`} onClick={() => setSelected(NEW)}>
            <Plus className="size-4" aria-hidden /> Nuevo rol
          </button>
        )}
      </Card>

      <RoleEditor
        key={selected}
        role={selected === NEW ? null : role}
        modules={modules}
        mine={mine}
        canManage={canManage}
        onSaved={(id) => { if (id) setSelected(id); router.refresh(); }}
        onDeleted={() => { setSelected(roles.find((r) => r.id !== selected)?.id ?? NEW); router.refresh(); }}
      />
    </div>
  );
}

function RoleEditor({
  role, modules, mine, canManage, onSaved, onDeleted,
}: {
  role: RoleSummary | null;
  modules: [string, PermissionInfo[]][];
  mine: Set<string>;
  canManage: boolean;
  onSaved: (newId?: string) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Un rol con permisos que yo no tengo no puedo editarlo (la API lo rechaza igual).
  const outranked = !!role && role.permissions.some((p) => !mine.has(p));
  const readOnly = !canManage || outranked;
  const toggle = (code: string, on: boolean) =>
    setPerms((s) => { const n = new Set(s); if (on) n.add(code); else n.delete(code); return n; });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const body = { name, permissions: [...perms] };
    const r = role ? await bff<{ id: string }>(`/bff/api/admin/roles/${role.id}`, "PATCH", body) : await bff<{ id: string }>("/bff/api/admin/roles", "POST", body);
    setBusy(false);
    if (r.ok) { setSaved(true); onSaved(role ? undefined : r.data.id); }
    else setError(r.status === 400 ? "Revisa el nombre (2 a 60 caracteres)." : errorText(r));
  }

  async function remove() {
    if (!role || !window.confirm(`¿Eliminar el rol «${role.name}»? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    setError(null);
    const r = await bff(`/bff/api/admin/roles/${role.id}`, "DELETE");
    setBusy(false);
    if (r.ok) onDeleted();
    else setError(errorText(r));
  }

  return (
    <Card>
      <form onSubmit={save} className="grid gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="block min-w-[260px] flex-1">
            <span className="mb-1.5 block text-xs font-medium text-ink-2">Nombre del rol</span>
            <input className={`${inputCls} ${readOnly ? "bg-surface-muted" : ""}`} value={name} onChange={(e) => setName(e.target.value)} readOnly={readOnly} required minLength={2} maxLength={60} placeholder="p. ej. Encargado de almacén" />
          </label>
          <div className="flex items-center gap-2">
            {role?.isSystemTemplate && <StatusBadge tone="info">Rol base</StatusBadge>}
            {readOnly && <StatusBadge tone="warning"><span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden /> Solo lectura</span></StatusBadge>}
          </div>
        </div>

        {outranked && (
          <p className="rounded-lg bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">
            Este rol incluye permisos que tú no tienes, por eso no puedes editarlo.
          </p>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          {modules.map(([module, list]) => {
            const grantable = list.filter((p) => mine.has(p.code));
            const allOn = grantable.length > 0 && grantable.every((p) => perms.has(p.code));
            return (
              <fieldset key={module} className="rounded-lg border border-line p-4">
                <legend className="px-1 text-[13px] font-semibold text-ink">{MODULE_LABELS[module] ?? module}</legend>
                {!readOnly && grantable.length > 1 && (
                  <button type="button" className="mb-2 text-xs font-medium text-brand hover:underline"
                    onClick={() => grantable.forEach((p) => toggle(p.code, !allOn))}>
                    {allOn ? "Quitar todos" : "Marcar todos"}
                  </button>
                )}
                <ul className="grid gap-2">
                  {list.map((p) => {
                    const canGrant = mine.has(p.code);
                    return (
                      <li key={p.code}>
                        <label className={`flex items-start gap-2.5 text-[13px] ${readOnly || !canGrant ? "text-ink-2" : "cursor-pointer text-body"}`}>
                          <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={perms.has(p.code)}
                            disabled={readOnly || (!canGrant && !perms.has(p.code))}
                            onChange={(e) => toggle(p.code, e.target.checked)} />
                          <span>
                            {PERMISSION_LABELS[p.code] ?? p.code}
                            {!canGrant && !readOnly && <span className="ml-1.5 text-xs text-ink-3">(no la tienes)</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </div>

        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
        {saved && !error && <p role="status" className="rounded-lg bg-success-soft px-3.5 py-2.5 text-[13px] text-success">Cambios guardados.</p>}

        {!readOnly && (
          <div className="flex items-center justify-between gap-3">
            <div>
              {role && !role.isSystemTemplate && (
                <button type="button" className={btnDanger} onClick={remove} disabled={busy}>
                  <Trash2 className="size-4" aria-hidden /> Eliminar rol
                </button>
              )}
            </div>
            <button className={btnPrimary} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {role ? "Guardar cambios" : "Crear rol"}
            </button>
          </div>
        )}
      </form>
    </Card>
  );
}
