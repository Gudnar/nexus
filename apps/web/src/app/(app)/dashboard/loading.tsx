const block = "animate-pulse rounded-lg bg-neutral-soft";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando resumen">
      <div className={`${block} mb-6 h-14 w-72`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-[116px]`} />)}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-12">
        <div className={`${block} h-64 xl:col-span-8`} />
        <div className={`${block} h-64 xl:col-span-4`} />
      </div>
    </div>
  );
}
