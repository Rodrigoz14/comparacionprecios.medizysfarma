import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// En Vercel (y cualquier entorno serverless) el disco del despliegue es de
// solo lectura, y cada petición puede caer en una instancia distinta sin
// disco compartido entre ellas -- por eso el archivo ya NO se guarda entre
// la petición de "analizar" y la de "confirmar" (bug real reportado por el
// cliente: fallaba con "ENOENT: no such file or directory, mkdir
// '/var/task/storage'" al intentar escribir, y aun corrigiendo eso con el
// directorio temporal del sistema, "confirmar" a veces caía en una
// instancia distinta a la de "analizar" y no encontraba el archivo).
// El cliente (ImportWizard.tsx) ya tiene el archivo completo en memoria
// desde que el usuario lo selecciona, así que ahora se reenvía completo en
// ambas peticiones -- ninguna de las dos depende de que el servidor
// recuerde nada entre una y otra.
//
// Lo único que sigue guardándose en disco es la copia "permanente" del
// archivo original (SupplierFile.storagePath), y solo como intento best-effort:
// no se lee de vuelta en ningún lugar de la aplicación hoy (no hay función
// de descargar el archivo importado), así que si falla no debe interrumpir
// la importación. Esa copia tampoco sobrevive indefinidamente en
// producción -- si más adelante se necesita poder descargar el archivo
// original, hace falta almacenamiento real persistente (Vercel Blob o
// similar), no el disco local.
const STORAGE_ROOT = path.join(tmpdir(), "medizys-storage", "supplier-files");

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Copia el archivo a una ubicación de referencia asociada al proveedor.
 * Best-effort: si el directorio temporal no está disponible por alguna
 * razón, no debe tumbar la importación completa -- devuelve null en vez de
 * lanzar, ya que nada depende de que esta copia exista.
 */
export async function persistSupplierFile(
  buffer: Buffer,
  supplierId: string,
  fileHash: string,
  originalName: string,
): Promise<string | null> {
  try {
    const dir = path.join(STORAGE_ROOT, supplierId);
    await mkdir(dir, { recursive: true });
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(dir, `${fileHash}__${safeName}`);
    await writeFile(filePath, buffer);
    return filePath;
  } catch {
    return null;
  }
}
