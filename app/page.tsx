import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";

const MODULES = [
  {
    label: "Proveedores",
    description: "Importar lista de precios",
    href: "/proveedores/importar",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 9.5 12 4l9 5.5M4.5 10.5v8a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-8M9.5 19.5v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5"
      />
    ),
  },
  {
    label: "Solicitudes",
    description: "Nueva solicitud de cliente",
    href: "/solicitudes/nueva",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 3.5h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1ZM14 3.5v4h4M9 12.5h6M9 16h6"
      />
    ),
  },
  {
    label: "Productos",
    description: "Catálogo homologado",
    href: null,
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3.5 4.5 7.25v9.5L12 20.5l7.5-3.75v-9.5L12 3.5ZM12 3.5v17M4.5 7.25 12 11l7.5-3.75"
      />
    ),
  },
  {
    label: "Órdenes de compra",
    description: "Seguimiento de pedidos",
    href: null,
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6h16M4 6l1.5 12a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1L20 6M9 10v4M15 10v4M8 6V4.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V6"
      />
    ),
  },
  {
    label: "Historial",
    description: "Cotizaciones anteriores",
    href: null,
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v5l3 2M4.5 12a7.5 7.5 0 1 1 2.5 5.6M4.5 12v4.5M4.5 12H9"
      />
    ),
  },
  {
    label: "Configuración",
    description: "Preferencias del sistema",
    href: null,
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.3 4.3a1.7 1.7 0 0 1 3.4 0 1.7 1.7 0 0 0 2.5 1.4 1.7 1.7 0 0 1 2.3 2.3A1.7 1.7 0 0 0 19.7 10.3a1.7 1.7 0 0 1 0 3.4 1.7 1.7 0 0 0-1.4 2.5 1.7 1.7 0 0 1-2.3 2.3 1.7 1.7 0 0 0-2.5 1.4 1.7 1.7 0 0 1-3.4 0 1.7 1.7 0 0 0-2.5-1.4 1.7 1.7 0 0 1-2.3-2.3A1.7 1.7 0 0 0 4.3 13.7a1.7 1.7 0 0 1 0-3.4 1.7 1.7 0 0 0 1.4-2.5 1.7 1.7 0 0 1 2.3-2.3 1.7 1.7 0 0 0 2.5-1.4ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
      />
    ),
  },
] as const;

export default async function Home() {
  await verifySession();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="bg-gradient-to-br from-brand-navy via-brand-blue to-brand-green px-6 py-14">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Medizys Procurement AI</h1>
          <p className="mt-2 max-w-xl text-blue-100">
            Compras inteligentes — comparación de proveedores y generación de cotizaciones.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-8 w-full max-w-3xl px-6 pb-16">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {MODULES.map((module) =>
            module.href ? (
              <Link
                key={module.label}
                href={module.href}
                className="group rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue transition-colors group-hover:bg-brand-blue group-hover:text-white">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                    {module.icon}
                  </svg>
                </span>
                <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{module.label}</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{module.description}</p>
              </Link>
            ) : (
              <div
                key={module.label}
                className="rounded-xl border border-zinc-200 bg-white p-4 opacity-60 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-900">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                    {module.icon}
                  </svg>
                </span>
                <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{module.label}</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{module.description}</p>
                <span className="mt-2 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900">
                  Próximamente
                </span>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
