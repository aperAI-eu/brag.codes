"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventList, ManagedEvent } from "../../events/model";
import { readTime, wallTime, defaultWindow } from "../../events/time";
import { metadataReview } from "../../events/prefill";
import { AdminReviewView, type EventReview, type ReviewErrors } from "../../ui/admin-events";
import { EventListView, EventDetailView, type EventFilters } from "../../ui/event-management";
import { ReauthenticationView } from "../../ui/share-recovery";
import { AdminScanner } from "../../events/admin-scanner";
import { useAccount } from "../account-shell";
import { Button } from "../../ui/components";

type Pending = { path: string; method: string; body: unknown; key: string };
class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string>,
  ) {
    super(code);
  }
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/v1/" + path, {
    method,
    cache: "no-store",
    signal: signal || AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new RequestError(
      response.status,
      data.error?.code || "temporarily_unavailable",
      data.error?.fields,
    );
  return data;
}
function reviewFor(event: ManagedEvent): EventReview {
  return {
    title: event.title,
    url: event.aliases[0]?.url || event.canonical_url,
    zone: event.timezone,
    starts: wallTime(Date.parse(event.starts_at), event.timezone),
    from: wallTime(Date.parse(event.submissions_open_at), event.timezone),
    to: wallTime(Date.parse(event.submissions_close_at), event.timezone),
    location: event.location,
    description: event.description,
    reason: "",
  };
}
const empty: EventReview = {
  title: "",
  url: "",
  starts: "",
  from: "",
  to: "",
  zone: "Europe/Bratislava",
  description: "",
  location: "",
  reason: "Register event",
};
const fields: Record<string, keyof EventReview> = {
  timezone: "zone",
  starts_at: "starts",
  submissions_open_at: "from",
  submissions_close_at: "to",
  title: "title",
  location: "location",
  description: "description",
  reason: "reason",
};
export default function EventsClient({ active }: { active: boolean }) {
  const { refresh } = useAccount();
  const [reauthBlocked, setReauthBlocked] = useState(false);
  const [view, setView] = useState<"list" | "paste" | "review" | "detail">("list");
  const [data, setData] = useState<EventList>({ events: [], next_cursor: null });
  const [filters, setFilters] = useState<EventFilters>({ query: "", approval: "", submission: "" });
  const [event, setEvent] = useState<ManagedEvent | null>(null);
  const [value, setValue] = useState<EventReview>(empty);
  const [errors, setErrors] = useState<ReviewErrors>({});
  const [link, setLink] = useState(""),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false),
    [denied, setDenied] = useState(false);
  const pending = useRef<Pending | null>(null),
    inFlight = useRef(false);
  const custom = useRef({ from: false, to: false });
  const epoch = useRef(0);
  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof RequestError && [401, 403].includes(e.status)) {
        setDenied(true);
        void refresh();
        setEvent(null);
        setData({ events: [], next_cursor: null });
        setError(
          "Admin access is unavailable. Sign in again or ask an administrator to check your role.",
        );
      } else if (e instanceof RequestError && e.status === 409)
        setError(
          "This event or link changed, or already exists. Reload the saved event or review the link again before making changes.",
        );
      else if (e instanceof RequestError && e.code === "unsupported_event_url")
        setError(
          "Use a clean public event URL from Luma, Meetup or Eventbrite.com, without query parameters, fragments or ticket codes.",
        );
      else if (e instanceof RequestError && e.fields) {
        const next: ReviewErrors = {};
        for (const [key, text] of Object.entries(e.fields)) next[fields[key] || "form"] = text;
        setErrors(next);
        setError(Object.values(e.fields).join(" "));
      } else if (e instanceof RequestError && e.status === 429)
        setError("Too many requests. Wait a minute, then retry.");
      else setError("Could not confirm the request. Please retry.");
    },
    [refresh],
  );
  useEffect(() => {
    if (active) setDenied(false);
    else ++epoch.current;
  }, [active]);
  const list = useCallback(
    async (selected: EventFilters, cursor?: string) => {
      const sequence = ++epoch.current;
      setBusy(true);
      setError("");
      try {
        const query = new URLSearchParams({ ...selected, ...(cursor ? { cursor } : {}) });
        const next = await request("admin/events?" + query);
        if (epoch.current === sequence) {
          setData(next);
          setView("list");
          setEvent(null);
        }
      } catch (e) {
        if (epoch.current === sequence) fail(e);
      } finally {
        if (epoch.current === sequence) setBusy(false);
      }
    },
    [fail],
  );
  useEffect(() => {
    void list({ query: "", approval: "", submission: "" });
    return () => {
      ++epoch.current;
    };
  }, [list]);
  const open = async (id: string) => {
    ++epoch.current;
    setBusy(true);
    setError("");
    try {
      setEvent((await request("admin/events/" + id)).event);
      setView("detail");
      setLink("");
      setReason("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const preview = async (url: string, signal: AbortSignal) => {
    setError("");
    setNotice("");
    try {
      const candidate = await request(
        "admin/event-candidates/preview",
        "POST",
        { url },
        undefined,
        signal,
      );
      if (signal.aborted) return;
      if (candidate.event) {
        setEvent(candidate.event);
        setView("detail");
        setNotice("This link already belongs to the saved event below.");
        setLink("");
      } else {
        setEvent(null);
        const imported = metadataReview(candidate.metadata);
        setValue({ ...empty, ...imported.value, url: candidate.url });
        setNotice(imported.notice);
        custom.current = { from: false, to: false };
        setErrors({});
        setView("review");
      }
    } catch (e) {
      if (!signal.aborted && e instanceof RequestError && [401, 403].includes(e.status)) fail(e);
      throw e;
    }
  };
  const mutate = async (intent: Pending) => {
    if (inFlight.current) return;
    inFlight.current = true;
    pending.current = intent;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request(intent.path, intent.method, intent.body, intent.key);
      pending.current = null;
      setUncertain(false);
      setEvent(result.event);
      setView("detail");
      setReason("");
      setLink("");
      setNotice("Saved. This event is available on your other devices.");
    } catch (e) {
      const unknown = !(e instanceof RequestError) || e.status >= 500 || e.status === 429;
      setUncertain(unknown);
      if (!unknown) pending.current = null;
      fail(e);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const change = (key: keyof EventReview, next: string) => {
    const copy = { ...value, [key]: next };
    if (key === "from" || key === "to") custom.current[key] = true;
    if (key === "zone") {
      for (const field of ["starts", "from", "to"] as const) {
        const parsed = readTime(value[field], value.zone);
        if (parsed.instant !== undefined) copy[field] = wallTime(parsed.instant, next);
      }
    }
    if (!event && (key === "starts" || key === "zone")) {
      const defaults = defaultWindow(copy.starts, copy.zone);
      for (const bound of ["from", "to"] as const)
        if (!custom.current[bound]) copy[bound] = defaults[bound];
    }
    setValue(copy);
    setErrors({});
  };
  const save = () => {
    const validation: ReviewErrors = {};
    const dates: Record<string, string> = {};
    for (const key of ["starts", "from", "to"] as const) {
      const parsed = readTime(value[key], value.zone);
      if (parsed.error) validation[key] = parsed.error;
      else dates[key] = new Date(parsed.instant!).toISOString();
    }
    if (!value.title.trim()) validation.title = "Give the event a title.";
    if (!value.reason?.trim()) validation.reason = "Give a reason for this change.";
    if (dates.from && dates.to && dates.from >= dates.to)
      validation.to = "To must be later than From.";
    setErrors(validation);
    if (Object.keys(validation).length) return;
    const details = {
      title: value.title,
      description: value.description,
      location: value.location,
      timezone: value.zone,
      starts_at: dates.starts,
      submissions_open_at: dates.from,
      submissions_close_at: dates.to,
    };
    void mutate({
      path: event ? `events/${event.id}` : "admin/events/whitelist",
      method: event ? "PATCH" : "POST",
      key: crypto.randomUUID(),
      body: {
        ...(event ? { expected_version: event.version } : { url: value.url }),
        event: details,
        reason: value.reason,
      },
    });
  };
  const action = (name: string, alias?: ManagedEvent["aliases"][number]) => {
    if (!event) return;
    const suffix = alias
      ? `source-aliases/${alias.id}${name === "approve_alias" ? "/approve" : ""}`
      : name === "add_alias"
        ? "source-aliases"
        : name;
    void mutate({
      path: `events/${event.id}/${suffix}`,
      method: name === "remove_alias" ? "DELETE" : "POST",
      key: crypto.randomUUID(),
      body: {
        expected_version: event.version,
        reason,
        ...(alias ? { expected_alias_version: alias.version } : {}),
        ...(name === "add_alias" ? { url: link } : {}),
      },
    });
  };
  const zones = [
    ...new Set(["Europe/Bratislava", "UTC", value.zone, ...Intl.supportedValuesOf("timeZone")]),
  ];
  if (!active || denied)
    return (
      <ReauthenticationView
        blocked={reauthBlocked}
        checking={false}
        message=""
        onOpen={() => {
          const popup = window.open("/sign-in?return_to=%2Fadmin", "_blank");
          if (popup) popup.opener = null;
          setReauthBlocked(!popup);
        }}
        onCheck={() => void refresh()}
      />
    );
  return (
    <>
      {notice && (
        <p className="access-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="access-error" role="alert">
          {error}
        </p>
      )}
      {denied ? (
        <a href="/sign-in?return_to=%2Fadmin">Sign in</a>
      ) : uncertain ? (
        <section className="access-card">
          <h2>Save not confirmed</h2>
          <p>
            The request may have reached the server. Retry the same change to recover its saved
            result.
          </p>
          <Button disabled={busy} onClick={() => pending.current && void mutate(pending.current)}>
            Retry same save
          </Button>
        </section>
      ) : (
        <fieldset className="event-workspace" disabled={busy}>
          {view === "list" && (
            <EventListView
              data={data}
              filters={filters}
              busy={busy}
              onFilters={setFilters}
              onSearch={() => void list(filters)}
              onNext={() => void list(filters, data.next_cursor!)}
              onOpen={(id) => void open(id)}
              onAdd={() => {
                ++epoch.current;
                setView("paste");
                setLink("");
                setError("");
                setNotice("");
              }}
            />
          )}
          {view === "paste" && (
            <AdminScanner onResolve={preview} onBack={() => void list(filters)} />
          )}
          {view === "review" && (
            <AdminReviewView
              live
              busy={busy}
              zones={zones}
              value={value}
              errors={errors}
              editing={!!event}
              onChange={change}
              onReset={() => {
                setValue({ ...value, ...defaultWindow(value.starts, value.zone) });
                custom.current = { from: false, to: false };
              }}
              onSave={save}
              onBack={() => {
                setError("");
                setView(event ? "detail" : "paste");
              }}
            />
          )}
          {view === "detail" && event && (
            <EventDetailView
              event={event}
              reason={reason}
              link={link}
              busy={busy}
              onReason={setReason}
              onLink={setLink}
              onEdit={() => {
                setValue(reviewFor(event));
                setErrors({});
                setError("");
                setView("review");
              }}
              onBack={() => void list(filters)}
              onRefresh={() => void open(event.id)}
              onAction={action}
            />
          )}
        </fieldset>
      )}
    </>
  );
}
