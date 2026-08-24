import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// En Vercel (y cualquier entorno serverless) el disco del despliegue es de
// solo lectura -- solo el directorio temporal del sistema operativo admite
// escritura, y ni siquiera ese es garantizado entre invocaciones distintas.
// Antes esto escribía en una carpeta "storage" propia del proyecto
// (process.cwd() + "storage"), que funcionaba en desarrollo local (un solo
// proceso de Node de larga duración) pero fallaba en producción con
// "ENOENT: no such file or directory, mkdir '/var/task/storage'" -- bug real
// reportado por el cliente al intentar subir una lista de Disfarma.
//
// UPLOADS_ROOT sí necesita funcionar de forma confiable: el archivo temporal
// debe sobrevivir entre la petición de "analizar" y la de "confirmar" del
// mismo asistente de importación, que ocurren segundos aparte -- Vercel
// normalmente reutiliza la misma instancia "caliente" para peticiones tan
// seguidas, así que esto funciona en la práctica aunque no esté 100%
// garantizado por el modelo serverless.
//
// STORAGE_ROOT (la copia "permanente" del archivo original) no se lee de
// vuelta en ningún lugar de la aplicación hoy (no hay función de descargar
// el archivo importado) -- guardarla en el directorio temporal evita que la
// importación falle, pero esa copia no sobrevive indefinidamente en
// producción. Si más adelante se necesita poder descargar el archivo
// original importado, hace falta almacenamiento real persistente (Vercel
// Blob o similar), no el disco local.
const STORAGE_ROOT = path.join(tmpdir(), "medizys-storage", "supplier-files");
const UPLOADS_ROOT = path.join(tmpdir(), "medizys-storage", "uploads");

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Guarda un archivo recién subido bajo un token temporal, antes de confirmar la importación. */
export async function saveTemporaryUpload(buffer: Buffer, originalName: string): Promise<string> {
  await mkdir(UPLOADS_ROOT, { recursive: true });
  const token = randomUUID();
  const filePath = path.join(UPLOADS_ROOT, `${token}__${originalName}`);
  await writeFile(filePath, buffer);
  return token;
}

async function findUploadPath(token: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(UPLOADS_ROOT).catch(() => [] as string[]);
  const match = files.find((f) => f.startsWith(`${token}__`));
  if (!match) throw new Error("El archivo temporal ya no existe. Vuelve a subirlo.");
  return path.join(UPLOADS_ROOT, match);
}

export async function readTemporaryUpload(token: string): Promise<{ buffer: Buffer; originalName: string }> {
  const filePath = await findUploadPath(token);
  const buffer = await readFile(filePath);
  const originalName = path.basename(filePath).split("__").slice(1).join("__");
  return { buffer, originalName };
}

/** Copia el archivo temporal a su ubicación definitiva, asociada al proveedor. */
export async function persistSupplierFile(
  buffer: Buffer,
  supplierId: string,
  fileHash: string,
  originalName: string,
): Promise<string> {
  const dir = path.join(STORAGE_ROOT, supplierId);
  await mkdir(dir, { recursive: true });
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(dir, `${fileHash}__${safeName}`);
  await writeFile(filePath, buffer);
  return filePath;
}
