import { prisma } from "@/lib/db/client";

export async function GET() {
  const suppliers = await prisma.supplier.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return Response.json({ suppliers });
}
