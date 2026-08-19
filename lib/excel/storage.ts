import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STORAGE_ROOT = path.join(process.cwd(), "storage", "supplier-files");
const UPLOADS_ROOT = path.join(process.cwd(), "storage", "uploads");

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
