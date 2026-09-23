import { stripAccents } from "@/lib/matching/normalize";

// Confirmado con el cliente (2026-09-23): FEC_VENC de Disfarma NO trae una
// fecha -- trae una categoría de texto ya calculada por el proveedor
// ("SUPERIOR A 12 MESES" o "FECHA CORTA <mes>", p. ej. "FECHA CORTA MAYO").
// No hay ninguna fecha real que parsear (ni año, ni día), así que la regla
// de negocio se aplica directo sobre esa categoría: solo "superior a 12
// meses" cuenta como vigencia segura; cualquier otra cosa (incluyendo texto
// no reconocido o ausente) se trata como riesgo -- más seguro que asumir
// que está bien.
export function isSafeExpirationLabel(label: string | null): boolean {
  if (!label) return false;
  const normalized = stripAccents(label).toLowerCase();
  return normalized.includes("superior") && normalized.includes("12");
}
