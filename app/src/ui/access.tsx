import type { RefObject } from "react";
import { Button, EmptyState, Icon, Tag } from "./components";

export type AccountSummary = { id: string; name: string; email: string };
export const signInProviders = ["Google", "Microsoft", "GitHub"] as const;
export type SignInProvider = (typeof signInProviders)[number] | "Email";

export function AccountMenu({
  user,
  canAdmin,
  menuRef,
  onNavigate,
  onSignOut,
}: {
  user: AccountSummary;
  canAdmin: boolean;
  menuRef: RefObject<HTMLDetailsElement | null>;
  onNavigate: (destination: "home" | "account" | "admin") => void;
  onSignOut: () => void;
}) {
  return (
    <details
      className="access-account-menu"
      ref={menuRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary role="button" aria-label="Account menu">
        <span className="access-initials" aria-hidden="true">
          {user.name.slice(0, 1)}
        </span>
        <Icon name="chevron" size={14} />
      </summary>
      <nav className="access-account-panel" aria-label="Account">
        <p className="small muted">Signed in as</p>
        <strong>{user.name}</strong>
        <span className="small muted">{user.email}</span>
        <Button variant="quiet" onClick={() => onNavigate("home")}>
          Back to brag
        </Button>
        <Button variant="quiet" onClick={() => onNavigate("account")}>
          My account
        </Button>
        {canAdmin && (
          <Button variant="quiet" onClick={() => onNavigate("admin")}>
            Admin
          </Button>
        )}
        <Button variant="quiet" onClick={onSignOut}>
          Sign out
        </Button>
      </nav>
    </details>
  );
}

export function SignInView({
  error,
  onProvider,
  onCancel,
  available,
  busy = false,
}: {
  error: string;
  onProvider: (provider: SignInProvider) => void;
  onCancel: () => void;
  available?: SignInProvider[];
  busy?: boolean;
}) {
  return (
    <section className="access-card access-sign-in">
      <p className="eyebrow">WELCOME TO BRAG</p>
      <h1>Sign in to brag.</h1>
      <p className="muted">
        Use an account you already have. We’ll bring you back to where you left off.
      </p>
      {error && (
        <p className="access-error" role="alert">
          {error}
        </p>
      )}
      <div className="access-provider-list">
        {signInProviders.map((provider) => (
          <Button
            key={provider}
            variant="secondary"
            disabled={busy || (available && !available.includes(provider))}
            onClick={() => onProvider(provider)}
          >
            Continue with {provider}
            {available && !available.includes(provider) ? " · Coming soon" : ""}
          </Button>
        ))}
      </div>
      <div className="access-divider">or</div>
      <Button
        variant="secondary"
        className="full-width"
        disabled={busy || (available && !available.includes("Email"))}
        onClick={() => onProvider("Email")}
      >
        <Icon name="mail" size={18} /> Continue with email
        {available && !available.includes("Email") ? " · Coming soon" : ""}
      </Button>
      <Button variant="quiet" className="full-width" onClick={onCancel}>
        Back to brag
      </Button>
    </section>
  );
}

export function AccessDeniedView({
  onHome,
  onSignOut,
}: {
  onHome: () => void;
  onSignOut: () => void;
}) {
  return (
    <section className="access-card">
      <EmptyState
        title="Admin access unavailable."
        action={<Button onClick={onHome}>Back to brag</Button>}
      >
        Your account doesn’t currently have the platform admin role.
      </EmptyState>
      <Button variant="quiet" className="full-width" onClick={onSignOut}>
        Sign out and use another account
      </Button>
    </section>
  );
}

export function AdminEntryView({
  events,
  onAdd,
  onEdit,
}: {
  events: {
    id: string;
    title: string;
    starts: string;
    from: string;
    to: string;
    zone: string;
  }[];
  onAdd: () => void;
  onEdit: (id: string) => void;
}) {
  return (
    <section className="access-admin">
      <div className="access-admin-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Events</h1>
        </div>
        <Button onClick={onAdd}>
          <Icon name="plus" size={18} /> Scan and add event
        </Button>
      </div>
      <p className="muted">Manage event links and brag.codes submission windows.</p>
      {events.map((event) => (
        <article key={event.id} className="access-card access-event">
          <div className="tag-list">
            <Tag tone="green">Whitelisted</Tag>
          </div>
          <h2>{event.title}</h2>
          <p className="muted">Starts {event.starts}</p>
          <h3>brag.codes submission window</h3>
          <dl className="access-window">
            <div>
              <dt>From</dt>
              <dd>{event.from}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{event.to}</dd>
            </div>
          </dl>
          <p className="small muted">{event.zone} · Submissions open and close automatically.</p>
          <Button
            variant="secondary"
            onClick={() => onEdit(event.id)}
            aria-label={`Manage ${event.title}`}
          >
            Manage event
          </Button>
        </article>
      ))}
    </section>
  );
}
