import { z } from "zod";
import { resolveProductMatch } from "@/lib/matching/matching-service";

const bodySchema = z.object({
  text: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Falta el texto del producto." }, { status: 400 });
  }

  const result = await resolveProductMatch(parsed.data.text);
  return Response.json(result);
}
