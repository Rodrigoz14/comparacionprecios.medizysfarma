import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Correo o contraseña inválidos." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || user.status !== "ACTIVE") {
    return Response.json({ error: "Credenciales incorrectas." }, { status: 401 });
  }

  const validPassword = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!validPassword) {
    return Response.json({ error: "Credenciales incorrectas." }, { status: 401 });
  }

  await createSession({ userId: user.id, role: user.role });
  await prisma.user.update({ where: { id: user.id }, data: { lastAccessAt: new Date() } });

  return Response.json({ ok: true, user: { name: user.name, role: user.role } });
}
