import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "medizys_session";

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET no está configurada.");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  role: "ADMIN" | "COMPRAS" | "CONSULTA";
  [key: string]: unknown;
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

export async function decryptSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
