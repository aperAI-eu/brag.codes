import { Button, Field, Icon, Tag, TextInput } from "./components";

export type EventReview = {
  title: string;
  url: string;
  starts: string;
  from: string;
  to: string;
  zone: string;
  description?: string;
  location?: string;
  reason?: string;
};
export type ReviewErrors = Partial<Record<keyof EventReview | "form", string>>;

export function AdminScanView({
  link,
  cameraDenied,
  error,
  onLink,
  onCameraDenied,
  onSample,
  onPaste,
  onBack,
}: {
  link: string;
  cameraDenied: boolean;
  error: string;
  onLink: (value: string) => void;
  onCameraDenied: (denied: boolean) => void;
  onSample: () => void;
  onPaste: () => void;
  onBack: () => void;
}) {
  return (
    <section className="access-card admin-flow">
      <Button variant="quiet" onClick={onBack}>
        <Icon name="back" size={16} /> Back to events
      </Button>
      <p className="eyebrow">ADD AN EVENT · 1 OF 2</p>
      <h1>Scan the event QR.</h1>
      <p className="muted">
        Use the event’s public link. You’ll review the details before whitelisting it.
      </p>
      <div className="admin-camera">
        <Icon name="grid" size={48} />
        <strong>{cameraDenied ? "Camera access denied" : "Camera preview (simulated)"}</strong>
        <p>
          {cameraDenied
            ? "Allow camera access in your browser, then retry. You can also paste the event link below."
            : "Place the event QR inside the frame."}
        </p>
      </div>
      <aside className="admin-fixture-note" aria-label="Scanner fixture controls">
        <p className="small">
          Catalogue simulation: no camera is opened. Try the sample QR or paste one of the example
          links below.
        </p>
        {cameraDenied ? (
          <Button variant="secondary" onClick={() => onCameraDenied(false)}>
            Retry camera (fixture)
          </Button>
        ) : (
          <>
            <Button onClick={onSample}>Simulate QR scan</Button>
            <Button variant="quiet" onClick={() => onCameraDenied(true)}>
              Simulate camera denial
            </Button>
          </>
        )}
      </aside>
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          onPaste();
        }}
        noValidate
      >
        <Field
          label="Event link"
          htmlFor="admin-event-link"
          hint="Paste the public event URL, not a ticket or check-in code."
        >
          <TextInput
            id="admin-event-link"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={link}
            aria-describedby="admin-event-link-hint admin-link-error"
            aria-invalid={!!error}
            onChange={(event) => onLink(event.target.value)}
            placeholder="https://luma.com/example-demo-night"
          />
        </Field>
        <div id="admin-link-error">
          {error && (
            <p role="alert" className="access-error">
              {error}
            </p>
          )}
        </div>
        <Button variant="secondary" type="submit">
          Review event link
        </Button>
      </form>
      <details className="admin-examples">
        <summary>Example links for this preview</summary>
        <p>
          New event: <code>https://luma.com/example-demo-night</code>
        </p>
        <p>
          Already whitelisted: <code>https://luma.com/example-builders</code>
        </p>
      </details>
    </section>
  );
}

export function AdminReviewView({
  value,
  errors,
  editing,
  onChange,
  onReset,
  onSave,
  onBack,
  busy = false,
  live = false,
  zones,
}: {
  busy?: boolean;
  live?: boolean;
  zones?: string[];
  value: EventReview;
  errors: ReviewErrors;
  editing: boolean;
  onChange: (key: keyof EventReview, value: string) => void;
  onReset: () => void;
  onSave: () => void;
  onBack: () => void;
}) {
  const dateField = (key: "starts" | "from" | "to", label: string) => (
    <Field label={label} htmlFor={`admin-${key}`}>
      <TextInput
        id={`admin-${key}`}
        type="datetime-local"
        required
        value={value[key]}
        onChange={(event) => onChange(key, event.target.value)}
        aria-invalid={!!errors[key]}
        aria-describedby={`admin-${key}-error admin-timezone`}
      />
      <p id={`admin-${key}-error`} className={errors[key] ? "access-error" : undefined}>
        {errors[key]}
      </p>
    </Field>
  );
  return (
    <section className="access-card admin-flow">
      <Button variant="quiet" onClick={onBack}>
        <Icon name="back" size={16} />{" "}
        {editing ? (live ? "Back to event" : "Back to events") : "Scan or paste another link"}
      </Button>
      <p className="eyebrow">{editing ? "MANAGE EVENT" : "ADD AN EVENT · 2 OF 2"}</p>
      <h1>{editing ? "Edit event." : "Review your event."}</h1>
      <div>
        <p className="small muted">Event QR link</p>
        <p className="admin-source">{value.url}</p>
      </div>
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
        noValidate
      >
        <Field label="Event title" htmlFor="admin-title">
          <TextInput
            id="admin-title"
            required
            maxLength={160}
            value={value.title}
            onChange={(event) => onChange("title", event.target.value)}
            aria-invalid={!!errors.title}
            aria-describedby="admin-title-error"
          />
          <p id="admin-title-error" className={errors.title ? "access-error" : undefined}>
            {errors.title}
          </p>
        </Field>
        <Field label="Event time zone" htmlFor="admin-zone">
          <select
            className="text-input"
            id="admin-zone"
            value={value.zone}
            onChange={(event) => onChange("zone", event.target.value)}
          >
            {(zones || ["Europe/Bratislava", "UTC"]).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
        {dateField("starts", "Event starts")}
        <fieldset className="admin-window-fields">
          <legend>brag.codes submission window</legend>
          <p className="small muted" id="admin-timezone">
            All times in {value.zone}. Adjust either time. Submissions open and close automatically.
          </p>
          {dateField("from", "From")}
          {dateField("to", "To")}
          <p className="small muted">
            Defaults: From 1 hour before the event starts; To 24 hours after it starts.
          </p>
          <Button type="button" variant="quiet" onClick={onReset}>
            Reset window to defaults
          </Button>
        </fieldset>
        {Object.values(errors).some(Boolean) && (
          <p className="access-error" role="alert">
            {errors.form || "Check the marked fields before continuing."}
          </p>
        )}
        <p className="small muted">
          {editing
            ? "Changes apply to the event and its existing QR link."
            : live
              ? "This approves the event link. New submissions will follow the window you set."
              : "Whitelisting enables this QR for attendees. New submissions follow the window you set."}
        </p>
        {live && (
          <>
            <Field label="Location (optional)" htmlFor="admin-location">
              <TextInput
                id="admin-location"
                maxLength={240}
                value={value.location || ""}
                onChange={(event) => onChange("location", event.target.value)}
              />
            </Field>
            <Field label="Description (optional)" htmlFor="admin-description">
              <textarea
                className="text-input"
                id="admin-description"
                maxLength={2000}
                value={value.description || ""}
                onChange={(event) => onChange("description", event.target.value)}
              />
            </Field>
            <Field label="Reason for change" htmlFor="admin-reason">
              <TextInput
                id="admin-reason"
                maxLength={300}
                required
                value={value.reason || ""}
                onChange={(event) => onChange("reason", event.target.value)}
              />
            </Field>
          </>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Whitelist event"}
        </Button>
      </form>
    </section>
  );
}

export function AdminConfirmationView({
  title,
  from,
  to,
  zone,
  editing,
  onEvents,
  onContribution,
}: {
  title: string;
  from: string;
  to: string;
  zone: string;
  editing: boolean;
  onEvents: () => void;
  onContribution: () => void;
}) {
  return (
    <section className="access-card admin-flow">
      <Tag tone="green">{editing ? "Updated in this preview" : "Whitelisted in this preview"}</Tag>
      <h1>{editing ? "Event updated." : "Event whitelisted."}</h1>
      <h2>{title}</h2>
      <p className="muted">
        Attendees can use the event QR. New submissions are accepted within this window:
      </p>
      <dl className="access-window">
        <div>
          <dt>From</dt>
          <dd>{from}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{to}</dd>
        </div>
      </dl>
      <p className="small muted">{zone} · Opens and closes automatically.</p>
      <Button onClick={onContribution}>Open contribution page</Button>
      <Button variant="secondary" onClick={onEvents}>
        Back to events
      </Button>
      <p className="small muted">
        Catalogue only. This entry exists in this preview until you reload or leave the flow.
      </p>
    </section>
  );
}
