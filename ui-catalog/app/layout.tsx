import type { Metadata } from "next";
import "../../app/src/ui/styles.css";
import "../../app/src/ui/access.css";
import "../../app/src/ui/share-work.css";
import "../../app/src/ui/agent-handoff.css";
import "../../app/src/ui/publication.css";
import "../../app/src/ui/project-deletion.css";
import "../../app/src/ui/gallery.css";

import "../../app/src/ui/identity.css";

export const metadata: Metadata = {
  title: "brag.codes — Small projects. Unexpected possibilities.",
  description: "An interactive prototype for sharing and discovering what people build.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
