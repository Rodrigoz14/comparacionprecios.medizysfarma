import { z } from "zod";
import { resolveProductMatch } from "@/lib/matching/matching-service";
import { getVerifiedSession } from "@/lib/auth/dal";

const bodySchema = z.object({
  text: z.string().min(1),
});

export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Falta el texto del producto." }, { status: 400 });
  }

  const result = await resolveProductMatch(parsed.data.text);
  return Response.json(result);
}
