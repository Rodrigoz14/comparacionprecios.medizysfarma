import { RequestWizard } from "@/components/solicitudes/RequestWizard";
import { verifySession } from "@/lib/auth/dal";

export default async function NuevaSolicitudPage() {
  await verifySession();
  return <RequestWizard />;
}
