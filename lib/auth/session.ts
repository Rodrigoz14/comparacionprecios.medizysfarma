import "server-only";
import { cookies } from "next/headers";
import { decryptSession, encryptSession, SESSION_COOKIE_NAME, type SessionPayload } from "@/lib/auth/jwt";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(payload: SessionPayload): Promise<void> {
  const expires = new Date(Date.now() + SESSION_DURATION_MS);
  const token = await encryptSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires,
    sameSite: "lax",
    path: "/",
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return decryptSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export type { SessionPayload };
