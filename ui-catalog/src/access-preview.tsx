"use client";

import { BrandLogo } from "../../app/src/ui/brand";
import { useEffect, useRef, useState } from "react";
import {
  AccountMenu,
  AccessDeniedView,
  SignInView,
  type AccountSummary,
  type SignInProvider,
} from "../../app/src/ui/access";
import { Button, EmptyState, Icon } from "../../app/src/ui/components";
import { ScannerPreview } from "./scanner-preview";
import { CapturePreview } from "./capture-preview";
import { ModerationNavigation } from "../../app/src/ui/moderation";
import { IntegrationsPreview } from "./integrations-preview";
import { AdminPreview, adminRoutes } from "./admin-preview";

// Fictional accounts and role assignments are deliberately independent of the provider choice.
const users: AccountSummary[] = [
  { id: "alex", name: "Alex Builder", email: "alex@example.com" },
  { id: "jan", name: "Jan Demo", email: "jan@example.com" },
];
const routes = [
  "home",
  "sign-in",
  "provider",
  "account",
  ...adminRoutes,
  "admin/integrations",
  "scan",
  "submit",
] as const;
type AccessRoute = (typeof routes)[number];

export function AccessPreview({
  route,
  navigate,
}: {
  route: string;
  navigate: (route: string) => void;
}) {
  const screen: AccessRoute = routes.includes(route as AccessRoute)
    ? (route as AccessRoute)
    : "home";
  const [providerMode, setProviderMode] = useState("all");
  const [selectedId, setSelectedId] = useState("alex");
  const [roles, setRoles] = useState<string[]>(["jan"]);
  const [user, setUser] = useState<AccountSummary | null>(null);
  const [pending, setPending] = useState<{ provider: SignInProvider; user: AccountSummary } | null>(
    null,
  );
  const [returnTo, setReturnTo] = useState<AccessRoute>("home");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetToken, setResetToken] = useState(0);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const selected = users.find((account) => account.id === selectedId)!;
  const canAdmin = !!user && roles.includes(user.id);
  const isAdminRoute = screen === "admin" || screen.startsWith("admin/");
  const go = (target: AccessRoute) => {
    if (menuRef.current) menuRef.current.open = false;
    navigate(target);
  };
  const signOut = () => {
    setUser(null);
    setPending(null);
    setError("");
    setReturnTo("home");
    setNotice("You’re signed out.");
    setResetToken((current) => current + 1);
    go("home");
  };

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [screen]);
  useEffect(() => {
    if (!user && (isAdminRoute || screen === "account" || screen === "submit")) {
      setReturnTo(screen);
      navigate("sign-in");
    }
  }, [screen, isAdminRoute, user, navigate]);

  return (
    <div className="access-preview">
      <aside className="access-fixtures" aria-label="Catalogue controls">
        <div>
          <strong>LOGIN &amp; ADMIN · INTERACTIVE CATALOGUE</strong>
          <p>
            Fictional accounts and events. Sign-in, scanning and saves are simulated; changes stay
            in this preview.
          </p>
        </div>
        <div className="access-fixture-actions">
          <label htmlFor="fixture-providers">Provider configuration</label>
          <select
            id="fixture-providers"
            value={providerMode}
            onChange={(event) => {
              setProviderMode(event.target.value);
              setPending(null);
              setError("");
              go("sign-in");
            }}
          >
            <option value="all">All fictional providers</option>
            <option value="github">Google and GitHub configured</option>
            <option value="unavailable">GitHub unavailable</option>
            <option value="pending">Preparing sign-in</option>
          </select>
          <label htmlFor="fixture-user">Sample user</label>
          <select
            id="fixture-user"
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              signOut();
            }}
          >
            {users.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() =>
              setRoles((current) =>
                current.includes(selectedId)
                  ? current.filter((id) => id !== selectedId)
                  : [...current, selectedId],
              )
            }
          >
            {roles.includes(selectedId)
              ? "Revoke admin role (fixture)"
              : "Assign admin role (fixture)"}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setUser(null);
              setPending(null);
              setNotice("Your session expired. Sign in again to continue.");
            }}
          >
            Expire session (fixture)
          </Button>
          <a href="#catalogue">Back to catalogue</a>
        </div>
        <p>
          Role controls above belong to this preview. Real role assignment is a separate authorized
          operator action.
        </p>
      </aside>
      <a
        className="skip-link"
        href="#access-main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="access-header">
        <a className="brand" href="#access/home">
          <BrandLogo />
        </a>
        {user ? (
          <AccountMenu
            user={user}
            canAdmin={canAdmin}
            menuRef={menuRef}
            onNavigate={go}
            onSignOut={signOut}
          />
        ) : (
          <Button
            variant="quiet"
            onClick={() => {
              setError("");
              setReturnTo("home");
              go("sign-in");
            }}
          >
            Sign in
          </Button>
        )}
      </header>
      <main id="access-main" className="access-main" tabIndex={-1} ref={mainRef}>
        {notice && (
          <p className="access-notice" role="status">
            {notice}
          </p>
        )}
        {screen === "home" && (
          <section className="access-home">
            <p className="eyebrow">SHARE WHAT YOU BUILT</p>
            <h1>
              Built something?
              <br />
              Brag about it.
            </h1>
            <p className="muted">Scan your event’s QR and tell us what you built.</p>
            <Button onClick={() => go("scan")}>
              <Icon name="grid" size={20} /> Scan event QR
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.hash = "";
              }}
            >
              Slop repository
            </Button>
          </section>
        )}
        {screen === "sign-in" && (
          <SignInView
            available={
              providerMode === "all"
                ? undefined
                : providerMode === "unavailable"
                  ? ["Google"]
                  : ["Google", "GitHub"]
            }
            busy={providerMode === "pending"}
            error={error}
            onProvider={(provider) => {
              setError("");
              setNotice("");
              setPending({ provider, user: selected });
              go("provider");
            }}
            onCancel={() => {
              setPending(null);
              setError("");
              setReturnTo("home");
              go("home");
            }}
          />
        )}
        {screen === "provider" &&
          (pending ? (
            <section className="access-card">
              <p className="eyebrow">
                SIMULATED {pending.provider === "Email" ? "EMAIL LINK" : "PROVIDER HANDOFF"}
              </p>
              <h1>
                {pending.provider === "Email"
                  ? "Check your email."
                  : `Continue with ${pending.provider}`}
              </h1>
              <p className="muted">
                {pending.provider === "Email"
                  ? "The real flow sends a sign-in link. No email is sent in this catalogue."
                  : "The real flow continues on the provider’s page, then returns to brag. This preview stays here."}
              </p>
              <p>
                Sample account: <strong>{pending.user.name}</strong>
                <br />
                <span className="small muted">{pending.user.email}</span>
              </p>
              <div className="access-provider-list">
                <Button
                  onClick={() => {
                    setUser(pending.user);
                    setPending(null);
                    setNotice("You’re signed in.");
                    go(returnTo);
                  }}
                >
                  Simulate successful sign-in
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPending(null);
                    setError("Sign-in was cancelled. You can try again.");
                    go("sign-in");
                  }}
                >
                  Cancel sign-in
                </Button>
                {pending.provider === "GitHub" && (
                  <>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setPending(null);
                        setError(
                          "This email belongs to an existing account. Sign in with its existing method. Provider linking is not available yet.",
                        );
                        go("sign-in");
                      }}
                    >
                      Simulate existing Google account
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setPending(null);
                        setError(
                          "GitHub did not provide a verified email. Verify an email on GitHub and try again, or choose another sign-in method.",
                        );
                        go("sign-in");
                      }}
                    >
                      Simulate no verified email
                    </Button>
                  </>
                )}
                <Button
                  variant="quiet"
                  onClick={() => {
                    setPending(null);
                    setError(
                      "Sign-in is unavailable right now. Try again or choose another method.",
                    );
                    go("sign-in");
                  }}
                >
                  Simulate sign-in error
                </Button>
              </div>
            </section>
          ) : (
            <section className="access-card">
              <EmptyState
                title="This sign-in attempt has expired."
                action={<Button onClick={() => go("sign-in")}>Sign in again</Button>}
              >
                Start a new sign-in to continue.
              </EmptyState>
            </section>
          ))}
        {screen === "account" && user && (
          <section className="access-card">
            <p className="eyebrow">MY ACCOUNT</p>
            <h1>{user.name}</h1>
            <p className="muted">{user.email}</p>
            <p>{canAdmin ? "Platform admin role assigned." : "No platform admin role assigned."}</p>
            <Button variant="secondary" onClick={() => go("home")}>
              Back to brag
            </Button>
          </section>
        )}
        {canAdmin && isAdminRoute && (
          <ModerationNavigation
            active={screen === "admin/integrations" ? "integrations" : "events"}
            onNavigate={(path) =>
              path === "/admin/moderation"
                ? window.location.assign("#moderation")
                : go(path === "/admin/integrations" ? "admin/integrations" : "admin")
            }
          />
        )}
        {canAdmin && screen === "admin/integrations" && <IntegrationsPreview key={user?.id} />}
        <AdminPreview
          route={screen}
          userId={user?.id || null}
          authorized={canAdmin}
          resetToken={resetToken}
          navigate={go}
        />
        {isAdminRoute && user && !canAdmin && (
          <AccessDeniedView onHome={() => go("home")} onSignOut={signOut} />
        )}
        {screen === "submit" && user && <CapturePreview key={user.id} />}
        {screen === "scan" && (
          <ScannerPreview onContinue={() => go("submit")} onCancel={() => go("home")} />
        )}
      </main>
    </div>
  );
}
