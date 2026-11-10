"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../app/account-shell";
import { useProjectDeletion } from "../deletion/use-project-deletion";
import {
  PublicationLifecycleEditor,
  PublicationRevisionReview,
  PublicationWithdrawView,
  LifecyclePublicView,
} from "../ui/publication-lifecycle";
import { PublicationOptionsView, type PublicationChoices } from "../ui/publication";
import { ShareMessageView } from "../ui/share-work";
import type { SharingDraft } from "../lib/projects/view";
import type { ProjectFields } from "../projects/model";
import type { OwnerPublication, PublicationReview } from "./model";

import { approvedChoices, Failure, initial, type Pending } from "./lifecycle-support";

export default function LifecycleClient({ id }: { id: string }) {
  const { account, loading } = useAccount();
  const [draft, setDraft] = useState<SharingDraft | null>(null),
    [fields, setFields] = useState<ProjectFields | null>(null),
    [publication, setPublication] = useState<OwnerPublication | null>(null),
    [choices, setChoices] = useState(initial),
    [screen, setScreen] = useState<"editor" | "options" | "review" | "withdraw" | "public">(
      "editor",
    ),
    [review, setReview] = useState<PublicationReview | null>(null),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false),
    [reauth, setReauth] = useState(false);
  const owner = useRef(account?.user.id),
    viewOwner = useRef<string | undefined>(undefined),
    epoch = useRef(0),
    lock = useRef(false),
    pending = useRef<Pending | null>(null),
    mutations = useRef(new Map<string, { intent: string; key: string }>());
  owner.current = account?.user.id;
  const home = () => window.location.assign("/my/projects");
  const storage = () => `brag-lifecycle:${owner.current}:${id}`;
  const unsaved = Boolean(
    draft && fields && JSON.stringify(draft.fields) !== JSON.stringify(fields),
  );
  const deletion = useProjectDeletion({
    draft,
    projectId: id,
    owner: account?.user.id,
    unsaved,
    onDeleted: home,
    onRefresh: () =>
      void action(async () => {
        await refresh(true);
        setNotice("Latest saved state loaded. Your local edits are retained.");
      }),
  });
  function remember(value: Pending | null) {
    pending.current = value;
    try {
      if (value) sessionStorage.setItem(storage(), JSON.stringify(value));
      else sessionStorage.removeItem(storage());
    } catch {
      /* Exact same-tab retry remains available without browser storage. */
    }
  }
  function key(kind: string, body: unknown) {
    const intent = JSON.stringify(body),
      old = mutations.current.get(kind);
    if (old?.intent === intent) return old.key;
    const value = crypto.randomUUID();
    mutations.current.set(kind, { intent, key: value });
    return value;
  }
  async function request<T>(path: string, method = "GET", body?: unknown, k?: string): Promise<T> {
    const seq = epoch.current,
      actor = owner.current;
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
    const value = await response.json();
    if (seq !== epoch.current || actor !== owner.current) throw new Error("Account changed.");
    if (!response.ok)
      throw new Failure(response.status, value.error?.code ?? "temporarily_unavailable");
    return value;
  }
  async function refresh(keepFields: boolean) {
    const [d, p] = await Promise.all([
      request<{ draft: SharingDraft }>(`/api/v1/drafts/${id}`),
      request<{ publication: OwnerPublication | null }>(`/api/v1/projects/${id}/publication-state`),
    ]);
    if (!p.publication) {
      window.location.replace(
        d.draft.event_id ? `/events/${d.draft.event_id}/submit/${id}` : `/submit/${id}`,
      );
      return;
    }
    viewOwner.current = owner.current;
    setDraft(d.draft);
    setPublication(p.publication);
    if (!keepFields) {
      setFields(d.draft.fields);
      setChoices(approvedChoices(p.publication, d.draft.fields));
    }
    setReview(null);
    setReviewed(false);
    setConflict(false);
    setScreen("editor");
    mutations.current.clear();
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
      if (seq !== epoch.current) return;
      if (e instanceof Failure) {
        if (e.status === 401) setReauth(true);
        if (
          e.code === "version_conflict" ||
          e.code === "review_consumed" ||
          e.code === "already_withdrawn"
        ) {
          setConflict(true);
          setReviewed(false);
        }
        if (e.code === "review_expired") {
          mutations.current.delete("review");
          setReviewed(false);
        }
        if (e.status === 404) {
          setDraft(null);
          setFields(null);
          setPublication(null);
        }
      }
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      if (seq === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    ++epoch.current;
    lock.current = false;
    const cleanup = () => {
      ++epoch.current;
    };
    if (loading) return cleanup;
    if (viewOwner.current && draft?.id === id) {
      if (!account) {
        setReauth(true);
        return cleanup;
      }
      if (viewOwner.current === account.user.id) {
        void action(async () => {
          await refresh(true);
          setReauth(false);
        });
        return cleanup;
      }
    }
    viewOwner.current = undefined;
    lock.current = false;
    pending.current = null;
    mutations.current.clear();
    setDraft(null);
    setFields(null);
    setPublication(null);
    setReview(null);
    setReviewed(false);
    setChoices(initial);
    setScreen("editor");
    setError("");
    setNotice("");
    setUncertain(false);
    setConflict(false);
    setReauth(false);
    if (!loading) {
      if (!account)
        window.location.assign(
          "/sign-in?return_to=" + encodeURIComponent(window.location.pathname),
        );
      else
        void action(async () => {
          await refresh(false);
          try {
            const v = JSON.parse(sessionStorage.getItem(storage()) ?? "null");
            if (
              v &&
              /^[a-f0-9-]{36}$/.test(v.key) &&
              ((v.action === "publish" && /^[a-f0-9-]{36}$/.test(v.body?.review_id)) ||
                (v.action === "withdraw" &&
                  Number.isSafeInteger(v.body?.expected_version) &&
                  Number.isSafeInteger(v.body?.expected_publication_revision)))
            ) {
              pending.current = v;
              setUncertain(true);
            }
          } catch {
            /* Malformed browser metadata cannot authorize a mutation. */
          }
        });
    }
    return () => {
      ++epoch.current;
    };
  }, [id, account?.user.id, loading]);
  useEffect(() => {
    if (!reauth) return;
    const resume = () =>
      void action(async () => {
        const actor = viewOwner.current,
          seq = epoch.current;
        const response = await fetch("/api/v1/session", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return;
        const value = await response.json();
        if (seq !== epoch.current || !value.account) return;
        if (value.account.user.id !== actor) {
          setFields(null);
          setDraft(null);
          setPublication(null);
          setChoices(initial);
          setReview(null);
          viewOwner.current = undefined;
          return;
        }
        if (owner.current === actor) {
          await refresh(true);
          setReauth(false);
        }
      });
    window.addEventListener("focus", resume);
    return () => window.removeEventListener("focus", resume);
  }, [reauth, id]);
  async function next() {
    if (!draft || !fields || !publication) return;
    if (publication.visibility === "hidden") throw new Failure(409, "publication_restricted");
    if (unsaved || draft.review.confirmed_version !== draft.version) {
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
    setReviewed(false);
  }
  async function prepare() {
    if (!draft || !publication) return;
    const body = {
      expected_version: draft.version,
      expected_publication_revision: publication.revision,
      public_author: {
        display_name: choices.name,
        contact: { kind: choices.contactKind, value: choices.contact },
      },
      include: {
        project_link: choices.includeProjectLink,
        repository_link: choices.includeRepositoryLink,
        details: choices.includeDetails,
      },
    };
    const result = await request<PublicationReview>(
      `/api/v1/projects/${id}/publication-review`,
      "POST",
      body,
      key("review", body),
    );
    setReview(result);
    setReviewed(false);
    setScreen("review");
  }
  async function commit(kind: "publish" | "withdraw", check = false) {
    if (!pending.current) {
      if (!draft || !publication) return;
      if (kind === "publish") {
        if (!review || !reviewed) return;
        remember({ action: kind, key: crypto.randomUUID(), body: { review_id: review.review_id } });
      } else
        remember({
          action: kind,
          key: crypto.randomUUID(),
          body: {
            expected_version: draft.version,
            expected_publication_revision: publication.revision,
          },
        });
    }
    const attempt = pending.current;
    if (!attempt) return;
    try {
      let found = false;
      if (check) {
        try {
          await request(
            `/api/v1/projects/${id}/${attempt.action === "publish" ? "publication" : "withdrawal"}-receipts/${attempt.key}`,
          );
          found = true;
        } catch (e) {
          if (!(e instanceof Failure && e.status === 404)) throw e;
        }
      }
      if (!found)
        await request(
          `/api/v1/projects/${id}/${attempt.action}`,
          "POST",
          attempt.body,
          attempt.key,
        );
      // Keep the receipt pending until a current-state read also succeeds. A historical
      // receipt never substitutes for current visibility after a concurrent transition.
      await refresh(true);
      remember(null);
      setUncertain(false);
      setNotice(
        attempt.action === "publish"
          ? "Publication confirmed. Showing the latest project state."
          : "Withdrawal confirmed. Showing the latest project state.",
      );
    } catch (e) {
      if (e instanceof Failure && e.status < 500 && e.status !== 429 && e.status !== 401) {
        remember(null);
        setUncertain(false);
        setReviewed(false);
      } else setUncertain(true);
      throw e;
    }
  }
  const editOptions = () => {
    mutations.current.delete("review");
    setReviewed(false);
    setScreen("options");
    setError("");
  };
  return (
    <main className="access-main" tabIndex={-1}>
      {reauth && viewOwner.current ? (
        <ShareMessageView
          title="Sign in to continue."
          message="Sign in in the new tab, then return here. Your local edits and original request are retained in this tab."
          action="Sign in to the same account"
          onAction={() =>
            window.open("/sign-in?return_to=/my/projects", "_blank", "noopener,noreferrer")
          }
          onHome={home}
        />
      ) : !account || viewOwner.current !== account.user.id ? (
        <ShareMessageView
          title={error ? "Project unavailable." : "Loading your project…"}
          message={error}
          action="My projects"
          onAction={home}
          onHome={home}
        />
      ) : deletion.active ? (
        deletion.view
      ) : uncertain ? (
        <ShareMessageView
          title="Result not yet confirmed."
          message={error || "Check the original result before making more changes."}
          action={busy ? "Checking…" : "Check result"}
          onAction={() => void action(() => commit(pending.current?.action ?? "publish", true))}
          onHome={home}
        />
      ) : conflict ? (
        <ShareMessageView
          title="This project changed elsewhere."
          message={
            error || "Your local edits are retained. Review the latest state before continuing."
          }
          action="Review latest state"
          onAction={() => void action(() => refresh(true))}
          onHome={home}
        />
      ) : !draft || !fields || !publication ? (
        <ShareMessageView
          title="Project unavailable."
          message="This project is no longer available, or you don’t have access."
          action="My projects"
          onAction={home}
          onHome={home}
        />
      ) : screen === "public" ? (
        publication.visibility === "published" && !publication.owner_withdrawn ? (
          <LifecyclePublicView
            content={publication.public_project}
            onBack={() => setScreen("editor")}
          />
        ) : (
          <ShareMessageView
            title="Public page unavailable."
            message="This project is not currently public."
            action="Back to private editor"
            onAction={() => setScreen("editor")}
            onHome={home}
          />
        )
      ) : screen === "withdraw" ? (
        <PublicationWithdrawView
          title={draft.fields.title}
          event={draft.event?.title ?? "No event linked"}
          unsaved={unsaved}
          busy={busy}
          error={error}
          onCancel={() => {
            setScreen("editor");
            setError("");
          }}
          onConfirm={() => void action(() => commit("withdraw"))}
        />
      ) : screen === "options" ? (
        <PublicationOptionsView
          title={fields.title}
          event={draft.event?.title ?? "No event linked"}
          choices={choices}
          projectUrl={fields.project_url}
          repositoryUrl={fields.repository_url}
          busy={busy}
          error={error}
          onChange={setChoices}
          onContinue={() => void action(prepare)}
          onBack={() => {
            setScreen("editor");
            setReviewed(false);
            setError("");
          }}
        />
      ) : screen === "review" && review ? (
        <PublicationRevisionReview
          previous={publication.public_project}
          next={review.public_project}
          version={publication.publication_version}
          visibility={publication.owner_withdrawn ? "withdrawn" : "published"}
          reviewed={reviewed}
          busy={busy}
          error={error}
          onReviewed={setReviewed}
          onEdit={editOptions}
          onPublish={() => void action(() => commit("publish"))}
        />
      ) : (
        <PublicationLifecycleEditor
          fields={fields}
          event={draft.event?.title ?? "No event linked"}
          visibility={publication.owner_withdrawn ? "withdrawn" : publication.visibility}
          version={publication.publication_version}
          notice={
            publication.visibility === "hidden"
              ? "Publication is restricted. Your private project remains available."
              : notice
          }
          error={error}
          busy={busy}
          onChange={(next) => {
            setFields(next);
            setChoices((old) => ({
              ...old,
              includeProjectLink: next.project_url === fields.project_url && old.includeProjectLink,
              includeRepositoryLink:
                next.repository_url === fields.repository_url && old.includeRepositoryLink,
            }));
          }}
          onContinue={() => void action(next)}
          onPublic={() =>
            void action(async () => {
              const value = await request<{ publication: OwnerPublication | null }>(
                `/api/v1/projects/${id}/publication-state`,
              );
              if (!value.publication) throw new Failure(404, "project_unavailable");
              setPublication(value.publication);
              setScreen("public");
            })
          }
          onWithdraw={() => {
            setScreen("withdraw");
            setError("");
          }}
          onDelete={deletion.open}
        />
      )}
    </main>
  );
}
