import type { Sector } from "@/lib/generated/prisma/client";

/**
 * Única fuente de verdad para los 5 sectores de negocio (confirmado con el
 * cliente, 2026-09-28) -- usada tanto en componentes de cliente (Proveedores,
 * Solicitudes) como en la validación zod de las rutas, para que la lista y
 * las etiquetas en español nunca queden desincronizadas entre pantallas.
 */
export const SECTOR_OPTIONS: { value: Sector; label: string }[] = [
  { value: "MEDICAMENTOS", label: "Medicamentos" },
  { value: "DISPOSITIVOS_MEDICOS", label: "Dispositivos médicos" },
  { value: "ODONTOLOGIA", label: "Odontología" },
  { value: "ASEO", label: "Aseo" },
  { value: "PAPELERIA", label: "Papelería" },
];

export const SECTOR_VALUES = SECTOR_OPTIONS.map((o) => o.value) as [Sector, ...Sector[]];

export const SECTOR_LABELS: Record<Sector, string> = Object.fromEntries(
  SECTOR_OPTIONS.map((o) => [o.value, o.label]),
) as Record<Sector, string>;
