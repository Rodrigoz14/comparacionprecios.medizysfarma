import { describe, expect, it } from "vitest";
import { encryptSession, decryptSession } from "@/lib/auth/jwt";

describe("encryptSession / decryptSession", () => {
  it("recupera el payload original tras cifrar y descifrar", async () => {
    const token = await encryptSession({ userId: "user-123", role: "ADMIN" });
    const payload = await decryptSession(token);
    expect(payload?.userId).toBe("user-123");
    expect(payload?.role).toBe("ADMIN");
  });

  it("devuelve null para un token invalido", async () => {
    expect(await decryptSession("token-invalido")).toBeNull();
  });

  it("devuelve null cuando no hay token", async () => {
    expect(await decryptSession(undefined)).toBeNull();
  });

  it("devuelve null para un token firmado con otro secreto", async () => {
    const originalSecret = process.env.AUTH_SECRET;
    const token = await encryptSession({ userId: "user-123", role: "ADMIN" });

    process.env.AUTH_SECRET = "un-secreto-completamente-distinto";
    try {
      expect(await decryptSession(token)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = originalSecret;
    }
  });
});
