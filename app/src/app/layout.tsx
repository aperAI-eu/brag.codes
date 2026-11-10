import { MobileProvider } from "../mobile/provider";
import type { Viewport } from "next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../ui/styles.css";
import "../ui/access.css";
import "../ui/share-work.css";
import "../ui/publication.css";
import "../ui/project-deletion.css";
import "../ui/gallery.css";
import "../ui/agent-handoff.css";
import { LegalFooter } from "../ui/legal";
import { AccountShell } from "./account-shell";

import "../ui/identity.css";

export const metadata: Metadata = {
  title: "brag.codes",
  description: "Share what you built at your event.",
  icons: { apple: "/pwa/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "brag.codes", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#7c9070",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AccountShell>
          <MobileProvider>{children}</MobileProvider>
        </AccountShell>
        <LegalFooter />
      </body>
    </html>
  );
}
