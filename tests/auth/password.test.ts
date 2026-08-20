import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("hashPassword / verifyPassword", () => {
  it("verifica correctamente una contraseña con su hash", async () => {
    const hash = await hashPassword("clave-super-secreta-123");
    expect(await verifyPassword("clave-super-secreta-123", hash)).toBe(true);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const hash = await hashPassword("clave-super-secreta-123");
    expect(await verifyPassword("otra-clave", hash)).toBe(false);
  });

  it("nunca guarda la contraseña en texto plano", async () => {
    const hash = await hashPassword("clave-super-secreta-123");
    expect(hash).not.toBe("clave-super-secreta-123");
    expect(hash.length).toBeGreaterThan(20);
  });

  it("produce hashes distintos para la misma contraseña (salt aleatorio)", async () => {
    const hashA = await hashPassword("misma-clave");
    const hashB = await hashPassword("misma-clave");
    expect(hashA).not.toBe(hashB);
  });
});
