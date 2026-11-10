import { legalDocument } from "../../legal/documents";
import { LegalDocumentView } from "../../ui/legal";

export const dynamic = "force-static";
export const metadata = { title: "Privacy Policy — brag.codes" };

export default async function Page() {
  return <LegalDocumentView text={await legalDocument("privacy-policy")} />;
}
