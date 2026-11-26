"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnSecondary, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

export function PlatformRegistration({ enabled: initial }: { enabled: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function toggle() {
    setBusy(true);
    setError(null);
    const r = await bff<{ registration: { enabled: boolean } }>("/bff/platform/registration", "PUT", { enabled: !enabled });
    setBusy(false);
    if (r.ok) setEnabled(r.data.registration.enabled);
    else if (r.status === 401) { router.replace("/plataforma/login"); router.refresh(); }
    else setError(errorText(r));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-ink-2">
            Cuando está habilitado, la pantalla de acceso muestra «Crear una cuenta» y cualquier persona puede solicitar una empresa nueva (periodo de prueba). La empresa solo se crea después de confirmar el correo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge tone={enabled ? "success" : "neutral"}>{enabled ? "Habilitado" : "Deshabilitado"}</StatusBadge>
          <button
            role="switch" aria-checked={enabled} aria-label="Registro de nuevas empresas" onClick={toggle} disabled={busy}
            className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-60 ${enabled ? "bg-brand" : "bg-line-strong"}`}
          >
            <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${enabled ? "left-6" : "left-1"}`} />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

export function PlatformLogout() {
  const router = useRouter();
  return (
    <button
      className={btnSecondary}
      onClick={async () => {
        await bff("/bff/platform/logout", "POST");
        router.replace("/plataforma/login");
        router.refresh();
      }}
    >
      <LogOut className="size-4" aria-hidden /> Salir
    </button>
  );
}
