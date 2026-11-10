"use client";

import { AdminScannerPreview } from "./admin-scanner-preview";
import { useEffect, useState } from "react";
import { AdminEntryView } from "../../app/src/ui/access";
import {
  AdminConfirmationView,
  AdminReviewView,
  AdminScanView,
  type EventReview,
  type ReviewErrors,
} from "../../app/src/ui/admin-events";
import { Button, EmptyState, Tag } from "../../app/src/ui/components";
import {
  defaultWindow,
  displayTime,
  exampleLink,
  fixtureLink,
  initialEvent,
  newReview,
  reviewFor,
  validateReview,
  type PreviewEvent,
} from "./admin-fixtures";

export const adminRoutes = [
  "admin",
  "admin/scan",
  "admin/review",
  "admin/existing",
  "admin/confirmed",
  "admin/contribution",
] as const;
export type AdminRoute = (typeof adminRoutes)[number];
type Draft = {
  owner: string;
  value: EventReview;
  id?: string;
  customFrom: boolean;
  customTo: boolean;
};

export function AdminPreview({
  cameraPreview = false,
  route,
  userId,
  authorized,
  resetToken,
  navigate,
}: {
  cameraPreview?: boolean;
  route: string;
  userId: string | null;
  authorized: boolean;
  resetToken: number;
  navigate: (route: AdminRoute) => void;
}) {
  const [events, setEvents] = useState<PreviewEvent[]>([initialEvent]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [receipt, setReceipt] = useState<{
    owner: string;
    event: PreviewEvent;
    editing: boolean;
  } | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [cameraDenied, setCameraDenied] = useState(false);
  const [scanError, setScanError] = useState("");
  const [errors, setErrors] = useState<ReviewErrors>({});

  // Expiry can retain an unsaved same-user draft; explicit sign-out discards it.
  useEffect(() => {
    setDraft(null);
    setReceipt(null);
    setExistingId(null);
    setLink("");
    setErrors({});
    setScanError("");
    setCameraDenied(false);
  }, [resetToken]);

  const active = authorized && !!userId;
  const ownedDraft = draft?.owner === userId ? draft : null;
  const ownedReceipt = receipt?.owner === userId ? receipt : null;
  const existing = events.find((event) => event.id === existingId);
  const back = () => navigate("admin");
  function openLink(input: string) {
    if (!active) return;
    const url = fixtureLink(input);
    if (!url) {
      setScanError(
        "Use one of this preview’s example event links. Ticket codes, unsafe URLs and other links are not supported here.",
      );
      return;
    }
    setScanError("");
    setErrors({});
    const found = events.find((event) => event.url === url);
    if (found) {
      setExistingId(found.id);
      navigate("admin/existing");
      return;
    }
    setDraft({ owner: userId!, value: newReview(url), customFrom: false, customTo: false });
    navigate("admin/review");
  }
  function edit(id: string) {
    if (!active) return;
    const event = events.find((item) => item.id === id);
    if (!event) return;
    setDraft({ owner: userId!, value: reviewFor(event), id, customFrom: true, customTo: true });
    setErrors({});
    navigate("admin/review");
  }
  function change(key: keyof EventReview, next: string) {
    if (!active || !ownedDraft) return;
    const value = { ...ownedDraft.value, [key]: next };
    if ((key === "starts" || key === "zone") && !ownedDraft.id) {
      const defaults = defaultWindow(value.starts, value.zone);
      if (!ownedDraft.customFrom) value.from = defaults.from;
      if (!ownedDraft.customTo) value.to = defaults.to;
    }
    setDraft({
      ...ownedDraft,
      value,
      customFrom: ownedDraft.customFrom || key === "from",
      customTo: ownedDraft.customTo || key === "to",
    });
    setErrors({});
  }
  function save() {
    if (!active || !ownedDraft) return;
    const checked = validateReview(ownedDraft.value);
    setErrors(checked.errors);
    if (!checked.event) return;
    const duplicate = events.find(
      (event) => event.url === checked.event!.url && event.id !== ownedDraft.id,
    );
    if (duplicate) {
      setExistingId(duplicate.id);
      navigate("admin/existing");
      return;
    }
    const event = { ...checked.event, id: ownedDraft.id || checked.event.url };
    setEvents((current) =>
      ownedDraft.id
        ? current.map((item) => (item.id === event.id ? event : item))
        : [...current, event],
    );
    setReceipt({ owner: userId!, event, editing: !!ownedDraft.id });
    setDraft(null);
    navigate("admin/confirmed");
  }

  if (!active || !adminRoutes.includes(route as AdminRoute)) return null;
  if (route === "admin")
    return (
      <AdminEntryView
        events={events.map((event) => ({
          ...event,
          starts: displayTime(event.starts, event.zone),
          from: displayTime(event.from, event.zone),
          to: displayTime(event.to, event.zone),
        }))}
        onAdd={() => {
          setScanError("");
          setLink("");
          setDraft(null);
          navigate("admin/scan");
        }}
        onEdit={edit}
      />
    );
  if (route === "admin/scan" && cameraPreview)
    return <AdminScannerPreview onResolve={openLink} onBack={back} />;
  if (route === "admin/scan")
    return (
      <AdminScanView
        link={link}
        cameraDenied={cameraDenied}
        error={scanError}
        onLink={setLink}
        onCameraDenied={setCameraDenied}
        onSample={() => openLink(exampleLink)}
        onPaste={() => openLink(link)}
        onBack={back}
      />
    );
  if (route === "admin/existing" && existing)
    return (
      <section className="access-card admin-flow">
        <Tag tone="green">Already whitelisted</Tag>
        <h1>This event is already here.</h1>
        <h2>{existing.title}</h2>
        <p className="admin-source">{existing.url}</p>
        <p className="muted">
          Review the existing event and its submission window. No duplicate will be created.
        </p>
        <Button onClick={() => edit(existing.id)}>Open existing event</Button>
        <Button variant="secondary" onClick={back}>
          Back to events
        </Button>
      </section>
    );
  if (route === "admin/review" && ownedDraft)
    return (
      <AdminReviewView
        value={ownedDraft.value}
        errors={errors}
        editing={!!ownedDraft.id}
        onChange={change}
        onSave={save}
        onBack={() => navigate(ownedDraft.id ? "admin" : "admin/scan")}
        onReset={() => {
          if (!active) return;
          setDraft({
            ...ownedDraft,
            value: {
              ...ownedDraft.value,
              ...defaultWindow(ownedDraft.value.starts, ownedDraft.value.zone),
            },
            customFrom: false,
            customTo: false,
          });
          setErrors({});
        }}
      />
    );
  if (route === "admin/confirmed" && ownedReceipt)
    return (
      <AdminConfirmationView
        title={ownedReceipt.event.title}
        from={displayTime(ownedReceipt.event.from, ownedReceipt.event.zone)}
        to={displayTime(ownedReceipt.event.to, ownedReceipt.event.zone)}
        zone={ownedReceipt.event.zone}
        editing={ownedReceipt.editing}
        onEvents={back}
        onContribution={() => navigate("admin/contribution")}
      />
    );
  if (route === "admin/contribution" && ownedReceipt)
    return (
      <section className="access-card admin-flow">
        <p className="eyebrow">ATTENDEE PREVIEW</p>
        <h1>{ownedReceipt.event.title}</h1>
        <h2>How would you like to share it?</h2>
        <p className="muted">Choose a way to prepare your project description.</p>
        <p className="admin-fixture-note small">
          Layout preview only. Capture and submission-window enforcement require the production
          service; these actions are not connected.
        </p>
        <Button disabled>Type it in</Button>
        <Button disabled>Record your pitch</Button>
        <Button disabled>Use your AI agent</Button>
        <Button variant="secondary" onClick={back}>
          Back to events
        </Button>
      </section>
    );
  return (
    <section className="access-card">
      <EmptyState
        title="Start from your events."
        action={<Button onClick={back}>Back to events</Button>}
      >
        There is no active review on this screen. Scan a link or open an existing event to continue.
      </EmptyState>
    </section>
  );
}
