import { Button, Icon } from "./components";
import { BrandLogo } from "./brand";

export type InstallationState =
  "available" | "manual" | "prompting" | "accepted" | "dismissed" | "failed" | "standalone";

export function MobileSupportLink({ onOpen }: { onOpen: () => void }) {
  return (
    <nav className="share-shortcuts" aria-label="App help">
      <Button variant="quiet" onClick={onOpen}>
        Install / app help
      </Button>
    </nav>
  );
}

export function InstallationHelpView({
  state,
  onInstall,
  onBack,
}: {
  state: InstallationState;
  onInstall: () => void;
  onBack: () => void;
}) {
  const messages: Record<InstallationState, string> = {
    available:
      "Add brag to your home screen for easy access. You can also keep using this browser.",
    manual:
      "Your browser isn’t offering an install prompt. Use the steps below, or keep using brag here.",
    prompting: "Finish or cancel in your browser’s installation prompt.",
    accepted:
      "Your browser accepted the install request. Look for brag on your home screen or in your apps.",
    dismissed: "Installation cancelled. You can keep using brag in this browser.",
    failed:
      "The install prompt couldn’t open. Try the manual steps below, or keep using this browser.",
    standalone: "You’re using the app. Scanning and sharing still need a connection.",
  };
  return (
    <section className="access-card admin-flow">
      <Button variant="quiet" onClick={onBack}>
        <Icon name="back" size={18} /> Back to where you were
      </Button>
      <p className="eyebrow">BRAG, ON YOUR HOME SCREEN</p>
      <h1>{state === "standalone" ? "App help." : "Make room for your ideas."}</h1>
      <p role={state === "failed" ? "alert" : "status"} className="muted">
        {messages[state]}
      </p>
      {(state === "available" || state === "prompting") && (
        <Button onClick={onInstall} disabled={state === "prompting"}>
          {state === "prompting" ? "Waiting for browser…" : "Install brag"}
        </Button>
      )}
      {state !== "standalone" && (
        <>
          <h2>iPhone or iPad</h2>
          <ol>
            <li>Open brag in Safari and open the Share menu.</li>
            <li>
              Choose <strong>Add to Home Screen</strong>. If it’s missing, check Edit Actions.
            </li>
            <li>
              Turn on <strong>Open as Web App</strong> if offered, then tap <strong>Add</strong>.
            </li>
          </ol>
          <h2>Android or computer</h2>
          <p>
            Open your browser’s menu and look for <strong>Install app</strong> or{" "}
            <strong>Add to Home screen</strong>. If neither is available, keep using brag in the
            browser.
          </p>
        </>
      )}
      <h2>Your work stays yours</h2>
      <p>
        Save any open work before launching from your home screen. The app opens the homepage; you
        may need to sign in again. Unsaved edits don’t move between browsers.
      </p>
      <p className="small muted">
        Installation is optional. It doesn’t create an account or approve an event. Camera images
        stay on your device.
      </p>
      <Button variant="secondary" onClick={onBack}>
        Continue where I was
      </Button>
    </section>
  );
}

export function OfflineFallbackView({
  retrying,
  message,
  onRetry,
  onHome,
}: {
  retrying: boolean;
  message: string;
  onRetry: () => void;
  onHome: () => void;
}) {
  return (
    <section className="access-card admin-flow">
      <BrandLogo />
      <p className="eyebrow">CONNECTION NEEDED</p>
      <h1>You’re offline.</h1>
      <p>Reconnect to open this page. Your projects and events need a fresh connection.</p>
      <p className="small muted">
        This screen doesn’t store your account or projects, and it won’t send anything when you
        reconnect. Only work already saved to brag is available after reopening.
      </p>
      <p role="status">{message || "When you’re connected, try again."}</p>
      <Button data-offline-retry disabled={retrying} onClick={onRetry}>
        {retrying ? "Trying…" : "Try again"}
      </Button>
      <Button data-offline-home variant="secondary" onClick={onHome}>
        Back to brag
      </Button>
    </section>
  );
}

export function MobilePreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="catalogue-access-link">
      <h2>Mobile app and admin camera</h2>
      <p>Optional installation, offline entry and scan-before-review administration.</p>
      <Button onClick={onOpen}>Open mobile preview</Button>
    </section>
  );
}
