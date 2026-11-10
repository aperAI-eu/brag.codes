"use client";
import { useEffect, useRef, useState } from "react";
import { ProjectDeleteView, type DeletionPhase } from "../ui/project-deletion";
import { ShareMessageView } from "../ui/share-work";
import type { SharingDraft } from "../lib/projects/view";
import type { DeletionIntent, DeletionReceipt } from "./model";

type Pending = { key: string; intent: DeletionIntent };
export function useProjectDeletion({
  draft,
  projectId,
  owner,
  unsaved,
  onDeleted,
  onRefresh,
}: {
  draft: SharingDraft | null;
  projectId?: string;
  owner: string | undefined;
  unsaved: boolean;
  onDeleted: () => void;
  onRefresh: () => void;
}) {
  const [active, setActive] = useState(false),
    [phase, setPhase] = useState<DeletionPhase>("confirm"),
    [error, setError] = useState(""),
    [unavailable, setUnavailable] = useState(false),
    [reauth, setReauth] = useState(false);
  const [target, setTarget] = useState<SharingDraft | null>(null);
  const pending = useRef<Pending | null>(null),
    generation = useRef(0),
    lock = useRef(false),
    identity = useRef(owner),
    boundOwner = useRef(owner),
    project = useRef(draft?.id);
  const id = projectId ?? draft?.id;
  identity.current = owner;
  project.current = id;
  const storage = (actor = owner, id = projectId ?? draft?.id) => `brag-deletion:${actor}:${id}`;
  function remember(value: Pending | null) {
    pending.current = value;
    try {
      if (value) sessionStorage.setItem(storage(), JSON.stringify(value));
      else sessionStorage.removeItem(storage());
    } catch {
      /* Same-tab exact retry remains available. */
    }
  }
  useEffect(() => {
    generation.current++;
    boundOwner.current = owner;
    setTarget(null);
    lock.current = false;
    pending.current = null;
    setActive(false);
    setReauth(false);
    setUnavailable(false);
    if (!owner || !id) return;
    try {
      const value = JSON.parse(sessionStorage.getItem(storage()) || "null") as Pending | null;
      if (
        value &&
        /^[a-f0-9-]{36}$/.test(value.key) &&
        Number.isSafeInteger(value.intent?.expected_version) &&
        typeof value.intent?.expected_published === "boolean"
      ) {
        pending.current = value;
        setTarget(draft);
        setPhase("uncertain");
        setActive(true);
        const epoch = generation.current;
        void fetch(`/api/v1/projects/${id}/deletion-receipts/${value.key}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        })
          .then(async (response) => {
            const result = await response.json();
            if (epoch !== generation.current || identity.current !== owner) return;
            if (
              response.ok &&
              result.deleted === true &&
              result.project_id === id &&
              result.receipt === value.key
            ) {
              remember(null);
              try {
                sessionStorage.setItem(`brag-deleted-notice:${owner}`, "1");
              } catch {
                /* Optional notice. */
              }
              onDeleted();
            } else if (response.status === 401) setReauth(true);
            else if (response.status === 404) setUnavailable(true);
          })
          .catch(() => {
            /* Keep the exact pending request for explicit reconciliation. */
          });
      }
    } catch {
      /* No valid retained request. */
    }
    return () => {
      generation.current++;
    };
  }, [owner, id]);
  useEffect(() => {
    if (active && !target && draft) setTarget(draft);
  }, [active, target, draft]);
  useEffect(() => {
    if (active) document.querySelector<HTMLElement>("main")?.focus();
  }, [active]);
  const keep = () => {
    setActive(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>(".project-delete-section button")?.focus(),
    );
  };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && active && phase === "confirm" && !reauth && !unavailable) keep();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [active, phase, reauth, unavailable]);
  async function run(check = false) {
    if (lock.current || !owner || !target) return;
    lock.current = true;
    const epoch = generation.current,
      actor = owner,
      id = target.id;
    const current = pending.current ?? {
      key: crypto.randomUUID(),
      intent: {
        expected_version: target.version,
        expected_published: target.has_publication ?? target.published,
      },
    };
    remember(current);
    setError("");
    setPhase("deleting");
    const valid = () =>
      epoch === generation.current && identity.current === actor && project.current === id;
    try {
      const request = async (method: string, path: string) =>
        fetch(path, {
          method,
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
          headers: { "Content-Type": "application/json", "Idempotency-Key": current.key },
          ...(method === "DELETE" ? { body: JSON.stringify(current.intent) } : {}),
        });
      let response = await request(
        check ? "GET" : "DELETE",
        `/api/v1/projects/${id}${check ? `/deletion-receipts/${current.key}` : ""}`,
      );
      let value = await response.json();
      if (!valid()) return;
      if (check && response.ok && value.status === "unconfirmed") {
        response = await request("DELETE", `/api/v1/projects/${id}`);
        value = await response.json();
        if (!valid()) return;
      }
      if (
        response.ok &&
        (value as DeletionReceipt).deleted === true &&
        value.project_id === id &&
        value.receipt === current.key
      ) {
        remember(null);
        setActive(false);
        try {
          sessionStorage.setItem(`brag-deleted-notice:${actor}`, "1");
          sessionStorage.removeItem(`brag-publication:${actor}:${id}`);
        } catch {
          /* Notice is non-authoritative. */
        }
        onDeleted();
        return;
      }
      if (response.status === 401) {
        setReauth(true);
        setPhase("uncertain");
        return;
      }
      if (response.status === 404) {
        setUnavailable(true);
        setPhase("uncertain");
        return;
      }
      if (response.status === 409) {
        remember(null);
        setPhase("conflict");
        return;
      }
      if (response.status >= 500) {
        setPhase("uncertain");
        return;
      }
      setPhase("confirm");
      setError(
        response.status === 429
          ? "Please wait a minute before trying again."
          : "Couldn’t delete this project. Nothing was changed. Try again.",
      );
    } catch {
      if (valid()) setPhase("uncertain");
    } finally {
      if (valid()) lock.current = false;
    }
  }
  return {
    active: active && boundOwner.current === owner && Boolean(owner),
    open: () => {
      if (draft && owner) {
        setTarget(draft);
        setActive(true);
        setPhase(pending.current ? "uncertain" : "confirm");
        setError("");
        setUnavailable(false);
        setReauth(false);
      }
    },
    view:
      boundOwner.current !== owner || !owner ? null : reauth ? (
        <ShareMessageView
          title="Sign in to continue."
          message="Sign in to the same account to check your project and continue."
          action="Sign in to the same account"
          onAction={() =>
            window.location.assign(
              "/sign-in?return_to=" + encodeURIComponent(window.location.pathname),
            )
          }
          onHome={() => window.location.assign("/my/projects")}
        />
      ) : unavailable ? (
        <ShareMessageView
          title="Project unavailable."
          message="This project is no longer available, or you don’t have access."
          action="My projects"
          onAction={() => window.location.assign("/my/projects")}
          onHome={() => window.location.assign("/")}
        />
      ) : !target ? (
        <ShareMessageView
          title="Checking deletion…"
          message="Checking the result of your previous request."
          action="Check deletion"
          onAction={() => window.location.reload()}
          onHome={() => window.location.assign("/my/projects")}
        />
      ) : (
        target && (
          <ProjectDeleteView
            title={target.fields.title}
            event={target.event?.title ?? "No event linked"}
            published={target.published}
            unsaved={unsaved}
            phase={phase}
            error={error}
            onKeep={keep}
            onConfirm={() => void run()}
            onCheck={() => void run(true)}
            onRefresh={() => {
              remember(null);
              setActive(false);
              onRefresh();
            }}
          />
        )
      ),
  };
}
