import { legalDocument } from "../../legal/documents";
import { LegalDocumentView } from "../../ui/legal";

export const dynamic = "force-static";
export const metadata = { title: "Terms of Service — brag.codes" };

export default async function Page() {
  return <LegalDocumentView text={await legalDocument("terms-of-service")} />;
}
