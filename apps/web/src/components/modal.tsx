"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Diálogo modal con el elemento nativo <dialog>: foco atrapado, Esc para cerrar y fondo
 * inerte sin código extra. El contenido solo se monta mientras está abierto (el formulario
 * arranca limpio cada vez).
 */
export function Modal({
  open, onClose, title, children, size = "md",
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; size?: "md" | "lg" }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onMouseDown={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={`m-auto w-[min(${size === "lg" ? "720px" : "540px"},94vw)] max-h-[90vh] rounded-lg border border-line bg-surface p-0 text-ink shadow-popover backdrop:bg-ink/40`}
      style={{ width: `min(${size === "lg" ? 720 : 540}px, 94vw)` }}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-md p-1.5 text-ink-2 hover:bg-neutral-soft" aria-label="Cerrar">
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
