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
