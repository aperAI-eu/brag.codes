import { AperAILogo } from "./aperai-brand";
import { Fragment, type ReactNode } from "react";

// This renderer handles the small, trusted Markdown subset used by our legal text.
// React escapes text; raw HTML is never interpreted.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = link[2] === "privacy-policy.md" ? "/privacy" : link[2];
      if (/^(https:\/\/|mailto:|#|\/(?!\/))/.test(href))
        return (
          <a key={index} href={href}>
            {link[1]}
          </a>
        );
      return <Fragment key={index}>{link[1]}</Fragment>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function LegalDocumentView({ text }: { text: string }) {
  return (
    <main className="legal-document">
      <a href="/">Back to brag.codes</a>
      <article>
        {text
          .trim()
          .split(/\n\s*\n/)
          .map((block, index) => {
            if (block.startsWith("# ")) return <h1 key={index}>{inline(block.slice(2))}</h1>;
            if (block.startsWith("## ")) return <h2 key={index}>{inline(block.slice(3))}</h2>;
            if (block.startsWith("- "))
              return (
                <ul key={index}>
                  {block.split(/\n(?=- )/).map((item, i) => (
                    <li key={i}>{inline(item.slice(2).replace(/\n\s*/g, " "))}</li>
                  ))}
                </ul>
              );
            return <p key={index}>{inline(block.replace(/\n/g, " "))}</p>;
          })}
      </article>
    </main>
  );
}

export function LegalFooter({
  privacyHref = "/privacy",
  termsHref = "/terms",
}: {
  privacyHref?: string;
  termsHref?: string;
}) {
  return (
    <footer className="legal-footer">
      <nav aria-label="Legal">
        <a href={privacyHref}>Privacy Policy</a>
        <a href={termsHref}>Terms of Service</a>
      </nav>
      <a className="powered-by" href="https://aperai.eu/" aria-label="Powered by aperAI">
        <span>Powered by</span>
        <AperAILogo />
      </a>
    </footer>
  );
}
