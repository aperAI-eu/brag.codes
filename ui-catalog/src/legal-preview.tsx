import { LegalDocumentView, LegalFooter } from "../../app/src/ui/legal";

export function LegalPreview({ terms }: { terms: boolean }) {
  return (
    <>
      <a className="legal-footer" href="#catalogue">
        Back to catalogue
      </a>
      <LegalDocumentView
        text={
          terms
            ? "# Example Terms of Service\n\nEffective date: 10 November 2026.\n\n## The service\n\nThis fictional project service lets people share their work.\n\n## Your content\n\nYou retain your rights. Read our [Privacy Policy](#legal/privacy)."
            : "# Example Privacy Policy\n\nEffective date: 10 November 2026.\n\n## Who we are\n\nThis is fictional catalogue content for a project sharing service.\n\n## Information we process\n\n- **Account information:** used to sign in.\n- **Your contributions:** saved and published when you choose.\n\n## Your rights\n\nContact [privacy@example.test](mailto:privacy@example.test) to ask about your information."
        }
      />
      <LegalFooter privacyHref="#legal/privacy" termsHref="#legal/terms" />
    </>
  );
}
