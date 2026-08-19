const MODULES = [
  "Cotizaciones",
  "Proveedores",
  "Productos",
  "Comparaciones",
  "Órdenes de compra",
  "Historial",
] as const;

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="w-full max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Medizys Procurement AI
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Compras inteligentes — comparación de proveedores y generación de
          cotizaciones.
        </p>

        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {MODULES.map((module) => (
            <div
              key={module}
              className="rounded-lg border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
            >
              {module}
              <span className="mt-1 block text-xs font-normal text-zinc-400">
                Próximamente
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
