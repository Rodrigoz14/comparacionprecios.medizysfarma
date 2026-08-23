import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";

export async function GET() {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const suppliers = await prisma.supplier.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return Response.json({ suppliers });
}

const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "El nombre no puede estar vacío."),
});

export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Nombre de proveedor inválido." }, { status: 400 });
  }

  const { name } = parsed.data;
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (existing) {
    return Response.json({ error: `Ya existe un proveedor activo llamado "${existing.name}".` }, { status: 409 });
  }

  const supplier = await prisma.supplier.create({
    data: { name },
    select: { id: true, name: true },
  });
  return Response.json({ supplier }, { status: 201 });
}
