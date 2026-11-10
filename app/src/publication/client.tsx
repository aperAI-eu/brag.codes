"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../app/account-shell";
import {
  PublicationEditorView,
  PublicationOptionsView,
  PublicationReviewView,
  PublicationSuccessView,
  type PublicationChoices,
} from "../ui/publication";
import { ShareMessageView } from "../ui/share-work";
import type { SharingDraft } from "../lib/projects/view";
import type { ProjectFields } from "../projects/model";
import type { PublicationReview, PublicationReceipt } from "./model";
const initial: PublicationChoices = {
  name: "",
  contactKind: "profile",
  contact: "",
  includeProjectLink: false,
  includeRepositoryLink: false,
  includeDetails: false,
};
const messages: Record<string, string> = {
  version_conflict:
    "This project changed elsewhere. Return to My projects and reopen it before preparing a new preview.",
  project_not_confirmed: "Save and approve your project before publishing it.",
  required_project_fields:
    "Add a project name, problem and description. Other fields are optional.",
  invalid_public_author: "Enter a public name of up to 100 characters.",
  invalid_public_contact:
    "Enter one public email address or an HTTPS profile link without sign-in details.",
  invalid_links: "Selected public links must use HTTPS without sign-in details.",
  review_expired: "This review expired. Edit public details to prepare a fresh preview.",
  admission_unverified:
    "This historical project has no verified admission. It remains private and editable; publication needs a live submission window.",
  event_suspended:
    "This event is suspended. Your project remains saved; publication can continue once access is restored.",
  review_consumed:
    "This project has already been published. Open its public page from My projects.",
  already_published:
    "This project has already been published. Private edits do not change its public page.",
  rate_limited: "Please wait a minute before trying again.",
};
class RequestError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(
      messages[code] ??
        "Couldn’t confirm this request. Your work is retained; retry uses the same request.",
    );
  }
}
export default function PublicationClient({ id }: { id: string }) {
  const { account, loading } = useAccount();
  const [draft, setDraft] = useState<SharingDraft | null>(null),
    [fields, setFields] = useState<ProjectFields | null>(null),
    [choice, setChoice] = useState(initial),
    [screen, setScreen] = useState<"edit" | "options" | "review" | "success">("edit"),
    [review, setReview] = useState<PublicationReview | null>(null),
    [receipt, setReceipt] = useState<PublicationReceipt | null>(null),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [stale, setStale] = useState(false);
  const viewOwner = useRef<string | undefined>(undefined);
  const epoch = useRef(0),
    lock = useRef(false),
    pending = useRef<{ key: string; reviewId: string } | null>(null),
    mutations = useRef(new Map<string, { intent: string; key: string }>()),
    owner = useRef<string | undefined>(undefined);
  owner.current = account?.user.id;
  const go = (path: string) => window.location.assign(path),
    home = () => go("/my/projects");
  const storage = () => `brag-publication:${owner.current}:${id}`;
  function remember(value: { key: string; reviewId: string } | null) {
    pending.current = value;
    try {
      if (value) sessionStorage.setItem(storage(), JSON.stringify(value));
      else sessionStorage.removeItem(storage());
    } catch {
      /* Retry remains available in this tab if browser storage is disabled. */
    }
  }
  function key(kind: string, value: unknown) {
    const intent = JSON.stringify(value),
      old = mutations.current.get(kind);
    if (old?.intent === intent) return old.key;
    const k = crypto.randomUUID();
    mutations.current.set(kind, { intent, key: k });
    return k;
  }
  async function request<T>(path: string, method = "GET", body?: unknown, k?: string): Promise<T> {
    const before = epoch.current,
      who = owner.current;
    const response = await fetch(path, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        "X-Capture-Contract": "share-work-v1",
        ...(k ? { "Idempotency-Key": k } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (before !== epoch.current || who !== owner.current)
      throw new Error("Your account or page changed.");
    if (response.status === 401) {
      go("/sign-in?return_to=" + encodeURIComponent(window.location.pathname));
      throw new RequestError("access_unavailable", 401);
    }
    if (!response.ok)
      throw new RequestError(data.error?.code ?? "temporarily_unavailable", response.status);
    return data;
  }
  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const seq = epoch.current;
    try {
      await fn();
    } catch (e) {
      if (seq === epoch.current) setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      if (seq === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function success(value: PublicationReceipt) {
    setReceipt(value);
    setScreen("success");
    setUncertain(false);
    remember(null);
  }
  async function publish() {
    if (!pending.current) {
      if (!review || !reviewed) return;
      remember({ key: crypto.randomUUID(), reviewId: review.review_id });
    }
    const attempt = pending.current;
    if (!attempt) return;
    try {
      if (uncertain) {
        try {
          success(
            await request<PublicationReceipt>(
              `/api/v1/projects/${id}/publication-receipts/${attempt.key}`,
            ),
          );
          return;
        } catch (e) {
          if (!(e instanceof RequestError && e.status === 404)) throw e;
        }
      }
      success(
        await request<PublicationReceipt>(
          `/api/v1/projects/${id}/publish`,
          "POST",
          { review_id: attempt.reviewId },
          attempt.key,
        ),
      );
    } catch (e) {
      if (e instanceof RequestError && e.status < 500 && e.status !== 429) {
        remember(null);
        setUncertain(false);
        setReviewed(false);
        if (e.code === "version_conflict") setStale(true);
      } else setUncertain(true);
      throw e;
    }
  }
  useEffect(() => {
    ++epoch.current;
    viewOwner.current = undefined;
    lock.current = false;
    mutations.current.clear();
    pending.current = null;
    setDraft(null);
    setFields(null);
    setChoice(initial);
    setReview(null);
    setReceipt(null);
    setReviewed(false);
    setUncertain(false);
    setStale(false);
    setScreen("edit");
    setError("");
    if (!loading) {
      if (!account) go("/sign-in?return_to=" + encodeURIComponent(window.location.pathname));
      else
        void action(async () => {
          const d = (await request<{ draft: SharingDraft }>(`/api/v1/drafts/${id}`)).draft;
          viewOwner.current = owner.current;
          setDraft(d);
          setFields(d.fields);
          try {
            const value = JSON.parse(sessionStorage.getItem(storage()) ?? "null");
            if (
              value &&
              /^[a-f0-9-]{36}$/.test(value.key) &&
              /^[a-f0-9-]{36}$/.test(value.reviewId)
            ) {
              pending.current = value;
              setUncertain(true);
            }
          } catch {
            /* A missing or malformed browser receipt does not authorize publishing. */
          }
        });
    }
    return () => {
      ++epoch.current;
    };
  }, [id, account?.user.id, loading]);
  async function next() {
    if (!draft || !fields) return;
    if (
      JSON.stringify(fields) !== JSON.stringify(draft.fields) ||
      draft.review.confirmed_version !== draft.version
    ) {
      const body = { expected_version: draft.version, fields, review_source: { method: "typed" } };
      const result = await request<{ draft: SharingDraft }>(
        `/api/v1/drafts/${id}`,
        "PATCH",
        body,
        key("save", body),
      );
      setDraft(result.draft);
      setFields(result.draft.fields);
    }
    setScreen("options");
  }
  async function prepare() {
    if (!draft) return;
    const body = {
      expected_version: draft.version,
      public_author: {
        display_name: choice.name,
        contact: { kind: choice.contactKind, value: choice.contact },
      },
      include: {
        project_link: choice.includeProjectLink,
        repository_link: choice.includeRepositoryLink,
        details: choice.includeDetails,
      },
    };
    try {
      setReview(
        await request<PublicationReview>(
          `/api/v1/projects/${id}/publication-review`,
          "POST",
          body,
          key("review", body),
        ),
      );
      setReviewed(false);
      setScreen("review");
    } catch (e) {
      if (e instanceof RequestError && e.code === "review_expired")
        mutations.current.delete("review");
      throw e;
    }
  }
  return (
    <main className="access-main">
      {!account || viewOwner.current !== account.user.id ? (
        <ShareMessageView
          title="Loading your project…"
          message={error}
          action="My projects"
          onAction={home}
          onHome={home}
        />
      ) : uncertain ? (
        <ShareMessageView
          title="Publication not yet confirmed."
          message={
            error ||
            "Check the original receipt before continuing. Retrying uses the same reviewed project and request."
          }
          action={busy ? "Checking…" : "Check publication"}
          onAction={() => void action(publish)}
          onHome={home}
        />
      ) : screen === "success" && receipt ? (
        <PublicationSuccessView
          title={review?.public_project.title ?? draft?.fields.title ?? "Project published"}
          onProject={() => go(receipt.public_url)}
          onEvent={() => go(receipt.event_url ?? "/slop")}
          hasEvent={receipt.event_url !== null}
        />
      ) : !draft || !fields ? (
        <ShareMessageView
          title={error ? "Couldn’t load your project." : "Loading your project…"}
          message={error}
          action="My projects"
          onAction={home}
          onHome={home}
        />
      ) : draft.has_publication ? (
        <ShareMessageView
          title="Your project is published."
          message="Your public page contains the version you approved. Private edits do not change that page."
          action="Edit published project"
          onAction={() => go("/my/projects/" + id)}
          onHome={home}
        />
      ) : screen === "edit" ? (
        <PublicationEditorView
          fields={fields}
          event={draft.event?.title ?? "No event linked"}
          error={error}
          busy={busy}
          onChange={setFields}
          onContinue={() => void action(next)}
          onBack={home}
        />
      ) : screen === "options" ? (
        <PublicationOptionsView
          title={fields.title}
          event={draft.event?.title ?? "No event linked"}
          choices={choice}
          projectUrl={fields.project_url}
          repositoryUrl={fields.repository_url}
          error={error}
          busy={busy}
          onChange={setChoice}
          onContinue={() => void action(prepare)}
          onBack={() => {
            setScreen("edit");
            setError("");
          }}
        />
      ) : review ? (
        <PublicationReviewView
          content={review.public_project}
          reviewed={reviewed}
          busy={busy}
          error={error}
          notice={
            (draft.event?.eligible ?? true)
              ? ""
              : "Work admitted during the submission window can still be published after closing."
          }
          onReviewed={setReviewed}
          onEdit={() => {
            mutations.current.delete("review");
            setScreen("options");
            setError("");
            setReviewed(false);
          }}
          onRefresh={
            stale
              ? () =>
                  void action(async () => {
                    const d = (await request<{ draft: SharingDraft }>(`/api/v1/drafts/${id}`))
                      .draft;
                    setDraft(d);
                    setFields(d.fields);
                    setReview(null);
                    setReviewed(false);
                    setStale(false);
                    setScreen("edit");
                  })
              : undefined
          }
          onPublish={() => void action(publish)}
        />
      ) : null}
    </main>
  );
}
