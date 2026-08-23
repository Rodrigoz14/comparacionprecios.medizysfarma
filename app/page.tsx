import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";

const MODULES = [
  { label: "Proveedores — Importar lista", href: "/proveedores/importar" },
  { label: "Nueva solicitud de cliente", href: "/solicitudes/nueva" },
  { label: "Productos", href: null },
  { label: "Órdenes de compra", href: null },
  { label: "Historial", href: null },
  { label: "Configuración", href: null },
] as const;

export default async function Home() {
  await verifySession();

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
          {MODULES.map((module) =>
            module.href ? (
              <Link
                key={module.label}
                href={module.href}
                className="rounded-lg border border-zinc-200 border-l-4 border-l-brand-blue bg-white p-4 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:border-l-brand-green hover:shadow-sm dark:border-zinc-800 dark:border-l-brand-blue dark:bg-zinc-950 dark:text-zinc-300"
              >
                {module.label}
              </Link>
            ) : (
              <div
                key={module.label}
                className="rounded-lg border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
              >
                {module.label}
                <span className="mt-1 block text-xs font-normal text-zinc-400">Próximamente</span>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
