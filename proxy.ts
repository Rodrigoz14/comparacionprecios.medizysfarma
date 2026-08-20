import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decryptSession, SESSION_COOKIE_NAME } from "@/lib/auth/jwt";

const PUBLIC_ROUTES = ["/login"];

/**
 * Chequeo optimista (solo lee la cookie, sin tocar la base de datos): la
 * protección real de cada ruta/endpoint la hace verifySession() en
 * lib/auth/dal.ts. Ver la guía de autenticación de Next.js.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname === route);

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await decryptSession(token);

  if (!isPublicRoute && !session?.userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isPublicRoute && session?.userId) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
