"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../app/src/ui/components";
import {
  InstallationHelpView,
  MobileSupportLink,
  OfflineFallbackView,
  type InstallationState,
} from "../../app/src/ui/mobile-support";
import { ShareHomeView, ShareMessageView, ShareShell } from "../../app/src/ui/share-work";
import { AdminPreview, type AdminRoute } from "./admin-preview";

type Screen = "home" | "admin" | "help" | "offline";
const admin = { id: "demo-admin", name: "Jan Demo", email: "jan@example.test" };
export function MobilePreview({ onExit }: { onExit: () => void }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [back, setBack] = useState<Screen>("home");
  const [route, setRoute] = useState<AdminRoute>("admin");
  const [install, setInstall] = useState<InstallationState>("available");
  const [access, setAccess] = useState<"admin" | "expired" | "denied">("admin");
  const [reset, setReset] = useState(0);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const main = useRef<HTMLElement>(null),
    menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    main.current?.focus();
  }, [screen, route, access]);
  const home = () => setScreen("home");
  const resetAll = () => {
    setReset((v) => v + 1);
    setScreen("home");
    setRoute("admin");
    setAccess("admin");
    setInstall("available");
    setConnected(false);
    setMessage("");
  };
  const help = () => {
    setBack(screen);
    setScreen("help");
  };
  return (
    <ShareShell
      user={access === "admin" && screen !== "offline" ? admin : null}
      mainRef={main}
      menuRef={menu}
      onNavigate={home}
      onSignIn={() => setAccess("admin")}
      onSignOut={() => {
        setAccess("denied");
        setReset((v) => v + 1);
      }}
    >
      {screen === "home" && (
        <ShareHomeView
          user={null}
          liveEvents={[]}
          eventCount={0}
          projectCount={0}
          onShare={() => {
            window.location.hash = "share/home";
          }}
          onNavigate={(route) => {
            window.location.hash = route === "slop" ? "gallery" : "share/home";
          }}
        />
      )}
      <AdminPreview
        cameraPreview
        route={route}
        userId={access === "admin" ? admin.id : null}
        authorized={access === "admin" && screen === "admin"}
        resetToken={reset}
        navigate={setRoute}
      />
      {screen === "admin" && access !== "admin" && (
        <ShareMessageView
          title={access === "expired" ? "Sign in again to continue." : "Admin access unavailable."}
          message={
            access === "expired"
              ? "Your review stays in this tab while you sign in again with the same account."
              : "This account can’t manage events. Previous review details have been cleared."
          }
          action={access === "expired" ? "Return as same admin (fixture)" : undefined}
          onAction={() => setAccess("admin")}
          onHome={home}
        />
      )}
      {screen === "help" && (
        <InstallationHelpView
          state={install}
          onInstall={() => setInstall("prompting")}
          onBack={() => setScreen(back)}
        />
      )}
      {screen === "offline" && (
        <OfflineFallbackView
          retrying={false}
          message={message}
          onRetry={() =>
            connected
              ? home()
              : setMessage("Still unable to connect. Try again after reconnecting.")
          }
          onHome={() =>
            connected
              ? home()
              : setMessage("The homepage also needs a connection. Nothing was sent.")
          }
        />
      )}
      {(screen === "home" || screen === "admin") && <MobileSupportLink onOpen={help} />}
      <details className="access-card" open>
        <summary>Fictional mobile controls</summary>
        <p className="small muted">
          Catalogue simulation. No app installation, service worker, camera or server changes. Admin
          fixtures are in memory only.
        </p>
        <div className="share-shortcuts">
          <Button variant="secondary" onClick={() => setScreen("admin")}>
            Open admin events
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setInstall("manual");
              setBack(screen === "help" ? back : screen);
              setScreen("help");
            }}
          >
            No install prompt
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setInstall("standalone");
              setBack(screen === "help" ? back : screen);
              setScreen("help");
            }}
          >
            Already in app
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setScreen("offline");
              setConnected(false);
              setMessage("");
            }}
          >
            Offline launch
          </Button>
          {screen === "offline" && (
            <Button variant="secondary" onClick={() => setConnected(true)}>
              Reconnect
            </Button>
          )}
          <Button variant="secondary" onClick={() => setAccess("expired")}>
            Session expires
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setAccess("denied");
              setReset((v) => v + 1);
            }}
          >
            Different account / role revoked
          </Button>
          <Button variant="secondary" onClick={resetAll}>
            Reset mobile preview
          </Button>
          <Button variant="quiet" onClick={onExit}>
            Back to catalogue
          </Button>
        </div>
        {install === "prompting" && screen === "help" && (
          <fieldset>
            <legend>Simulated browser prompt</legend>
            <div className="share-shortcuts">
              <Button onClick={() => setInstall("accepted")}>Accept installation</Button>
              <Button variant="secondary" onClick={() => setInstall("dismissed")}>
                Cancel installation
              </Button>
              <Button variant="secondary" onClick={() => setInstall("failed")}>
                Prompt fails
              </Button>
            </div>
          </fieldset>
        )}
      </details>
    </ShareShell>
  );
}
