import type { Metadata } from "next";
import { getPublicConfig } from "@/lib/public-config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

const FEATURES = [
  { src: "03_feature_sales_icon.png", label: "Ventas", w: 90 },
  { src: "04_feature_inventory_icon.png", label: "Inventario", w: 95 },
  { src: "05_feature_reports_icon.png", label: "Reportes", w: 95 },
  { src: "06_feature_ecommerce_icon.png", label: "Ecommerce", w: 95 },
];

// Los assets son recortes opacos del mockup: se funden con el fondo (multiply + máscaras).
const FADE = {
  maskImage:
    "linear-gradient(to right, transparent, #000 9%, #000 91%, transparent), linear-gradient(to bottom, transparent, #000 14%)",
  maskComposite: "intersect",
  WebkitMaskImage:
    "linear-gradient(to right, transparent, #000 9%, #000 91%, transparent), linear-gradient(to bottom, transparent, #000 14%)",
  WebkitMaskComposite: "source-in",
} as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string; outside?: string }> }) {
  const { expired, outside } = await searchParams;
  const config = await getPublicConfig();

  return (
    <div className="relative flex min-h-screen flex-col bg-[#f2f5ff]">
      <main className="grid flex-1 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
        {/* Panel de marca */}
        <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#e4ebff] via-[#f0f4ff] to-[#f8faff] lg:flex lg:flex-col">
          <div className="px-14 pt-12 xl:px-20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/login/01_brand_logo_nexus_erp.png" alt="NEXUS ERP — Gestión empresarial inteligente" width={320} height={88} className="mix-blend-multiply" />
            <div className="mt-5 h-[3px] w-16 rounded-full bg-nx-accent" aria-hidden />
            <h1 className="mt-8 text-[44px] font-bold leading-[1.1] tracking-tight text-nx-navy xl:text-[52px]">
              Tu negocio,
              <br />
              en mejores manos
            </h1>
            <p className="mt-5 max-w-md text-lg leading-snug text-nx-navy/80">
              Administra, vende y crece con una plataforma completa y moderna.
            </p>
            <ul className="mt-8 flex gap-5" aria-label="Módulos principales">
              {FEATURES.map((f) => (
                <li key={f.src}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/login/${f.src}`} alt={f.label} width={f.w} height={110} className="mix-blend-multiply" />
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-auto px-6 pb-0 xl:px-12">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/login/02_hero_illustration_laptop_plant_mug.png"
              alt=""
              aria-hidden
              className="mx-auto block h-[268px] w-full max-w-[840px] object-cover object-bottom mix-blend-multiply"
              style={FADE}
            />
          </div>
        </section>

        {/* Formulario */}
        <section className="relative grid place-items-center bg-white px-5 py-12 sm:px-10">
          <div className="absolute -right-24 -top-24 size-72 rounded-full bg-nx-soft/70 blur-2xl" aria-hidden />
          <div className="relative w-full max-w-[460px]">
            <div className="mb-8 lg:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/login/01_brand_logo_nexus_erp.png" alt="NEXUS ERP" width={240} height={66} className="mx-auto mix-blend-multiply" />
            </div>
            <div className="rounded-[22px] border border-slate-100 bg-white p-8 shadow-[0_24px_64px_rgba(35,75,196,0.10)] sm:p-10">
              <div className="flex flex-col items-center text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/login/07_login_security_lock_icon.png" alt="" aria-hidden width={104} height={96} className="-mt-2 mix-blend-multiply" />
                <h2 className="mt-1 text-[30px] font-bold tracking-tight text-nx-navy">Iniciar sesión</h2>
                <p className="mt-1 text-base text-slate-600">Accede a tu cuenta para continuar</p>
              </div>
              {outside && (
                <p role="status" className="mt-6 rounded-lg bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
                  Tu sesión se cerró porque estás fuera de tu horario de acceso.
                </p>
              )}
              {expired && (
                <p role="status" className="mt-6 rounded-lg bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
                  Tu sesión expiró. Inicia sesión de nuevo.
                </p>
              )}
              <LoginForm registrationEnabled={config.registrationEnabled} />
              <p className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-[#f1f4fd] py-3 text-[13px] text-slate-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/login/11_security_shield_icon.png" alt="" aria-hidden width={22} height={22} className="mix-blend-multiply" />
                Conexión segura y datos protegidos
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="flex h-14 items-center justify-center gap-2 border-t border-slate-200/70 bg-white/80 text-[13px] text-slate-500">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/login/12_footer_globe_icon.png" alt="" aria-hidden width={20} height={18} className="mix-blend-multiply" />
        NEXUS ERP · v0.1
      </footer>
    </div>
  );
}
