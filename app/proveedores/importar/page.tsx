import { ImportWizard } from "@/components/proveedores/ImportWizard";
import { verifySession } from "@/lib/auth/dal";

export default async function ImportarProveedorPage() {
  await verifySession();
  return <ImportWizard />;
}
