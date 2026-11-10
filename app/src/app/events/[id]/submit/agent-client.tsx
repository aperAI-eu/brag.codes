"use client";
import { useState } from "react";
import { Button } from "../../../../ui/components";
import type { DraftView } from "../../../../projects/model";
type Handoff = { code: string; instruction: string; expires_at: string };
type LinkRequest = { id: string; verificationCode: string; state: string };
export default function AgentCapture({
  draft,
  ensureDraft,
  onResume,
}: {
  draft: DraftView | null;
  ensureDraft: () => Promise<DraftView>;
  onResume: () => void;
}) {
  const [handoff, setHandoff] = useState<Handoff | null>(null),
    [requests, setRequests] = useState<LinkRequest[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState("");
  async function call(path: string, body: unknown = {}, method = "POST") {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        "Couldn’t update the agent connection. Sign in and check whether it has expired.",
      );
    return data;
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const current = await ensureDraft();
    const data = await call(`/api/v1/drafts/${current.id}/handoff`);
    setHandoff(data.handoff);
    setRequests(data.requests);
  }
  return (
    <>
      <h1>Use your AI agent.</h1>
      <p>
        Continue from your project workspace. Your agent can prepare this private draft after you
        approve its connection.
      </p>
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
      {handoff ? (
        <>
          <p className="eyebrow">CODE_ID</p>
          <p>
            <code>{handoff.code}</code>
          </p>
          <p className="small muted">
            Expires {new Date(handoff.expires_at).toLocaleTimeString()}.
          </p>
          <p className="agent-instruction">{handoff.instruction}</p>
          <Button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await navigator.clipboard.writeText(handoff.instruction);
              })
            }
          >
            Copy agent instruction
          </Button>
        </>
      ) : (
        <Button disabled={busy} onClick={() => void action(refresh)}>
          Prepare agent handoff
        </Button>
      )}
      {handoff && (
        <>
          <Button variant="secondary" disabled={busy} onClick={() => void action(refresh)}>
            Check for agent requests
          </Button>
          {requests.map((request) => (
            <div key={request.id} className="pitch-proposal">
              <h2>Agent request: {request.verificationCode}</h2>
              <p>Status: {request.state}</p>
              {request.state === "pending" && (
                <>
                  <p>
                    Compare this code with the one your agent shows. Approval allows reading and
                    editing only this draft until expiry. It cannot publish or process audio.
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed === request.id}
                      onChange={(e) => setConfirmed(e.target.checked ? request.id : "")}
                    />{" "}
                    The code matches my agent
                  </label>
                  <Button
                    disabled={busy || confirmed !== request.id}
                    onClick={() =>
                      void action(async () => {
                        await call(`/api/v1/agent-requests/${request.id}`, {
                          verification_code: request.verificationCode,
                          approve: true,
                        });
                        await refresh();
                      })
                    }
                  >
                    Approve this agent
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await call(`/api/v1/agent-requests/${request.id}`, {
                          verification_code: request.verificationCode,
                          approve: false,
                        });
                        await refresh();
                      })
                    }
                  >
                    Decline
                  </Button>
                </>
              )}
            </div>
          ))}
          <Button
            variant="quiet"
            disabled={busy || !draft}
            onClick={() =>
              void action(async () => {
                await call(`/api/v1/drafts/${draft!.id}/handoff`, {}, "DELETE");
                setHandoff(null);
                setRequests([]);
              })
            }
          >
            Revoke agent access
          </Button>
          <Button disabled={busy} onClick={onResume}>
            Review my draft
          </Button>
        </>
      )}
    </>
  );
}
