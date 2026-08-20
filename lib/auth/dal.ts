import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

/**
 * Chequeo "seguro" de sesión: para usar en páginas, route handlers y server
 * actions. Redirige a /login si no hay sesión válida. `proxy.ts` hace un
 * chequeo optimista (solo lee la cookie) para la experiencia de navegación,
 * pero esta función es la que realmente protege cada punto de entrada.
 */
export const verifySession = cache(async () => {
  const session = await getSession();
  if (!session?.userId) {
    redirect("/login");
  }
  return session;
});

/** Igual que verifySession, pero devuelve null en vez de redirigir (para route handlers de API). */
export const getVerifiedSession = cache(async () => {
  const session = await getSession();
  if (!session?.userId) return null;
  return session;
});
