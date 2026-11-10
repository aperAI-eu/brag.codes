import { Button } from "../../app/src/ui/components";
import { sampleEvents, type Scenario } from "./sharing-fixtures";
import { AgentSimulationControls } from "./agent-simulation-controls";
import type { useAgentPreview } from "./use-agent-preview";

// Catalogue-only simulation controls, outside the reusable product shell.
export function SharingControls({
  userId,
  scenario,
  clock,
  language,
  providerPending,
  recording,
  agentSimulation,
  onUser,
  onScenario,
  onExpire,
  onReset,
  onTime,
  onLanguage,
  onLogin,
  onLoginFailure,
  onCameraDenied,
  onScan,
  onOffline,
  onClose,
  onSuspend,
  onWarning,
  onLimit,
  onSaveFailure,
  recoveryMode,
  processing,
  savedProject,
  onFailProcessing,
  onStaleAgent,
  onUpgrade,
  onBlockedAuth,
  onReauthReady,
}: {
  recoveryMode: boolean;
  processing: boolean;
  savedProject: boolean;
  onFailProcessing: () => void;
  onStaleAgent: () => void;
  onUpgrade: () => void;
  onBlockedAuth: () => void;
  onReauthReady: (different: boolean) => void;
  userId: string;
  scenario: Scenario;
  clock: string;
  language: "sk" | "cs" | "en";
  providerPending: boolean;
  recording: boolean;
  agentSimulation: ReturnType<typeof useAgentPreview>["simulation"];
  onUser: (id: string) => void;
  onScenario: (value: Scenario) => void;
  onExpire: () => void;
  onReset: () => void;
  onTime: (value: string) => void;
  onLanguage: (value: "sk" | "cs" | "en") => void;
  onLogin: () => void;
  onLoginFailure: () => void;
  onCameraDenied: () => void;
  onScan: (id: string) => void;
  onOffline: () => void;
  onClose: () => void;
  onSuspend: () => void;
  onWarning: () => void;
  onLimit: () => void;
  onSaveFailure: () => void;
}) {
  return (
    <aside className="access-fixtures" aria-label="Sharing catalogue controls">
      <strong>SHARE YOUR WORK · PHASE 0 PREVIEW</strong>
      <p>
        Fictional accounts and events. No camera, microphone, providers or server saves. Changes
        stay in this tab and reset on reload.
      </p>
      <details>
        <summary>Preview scenarios and simulations</summary>
        <div className="access-fixture-actions">
          <label htmlFor="share-user">Sample identity</label>
          <select id="share-user" value={userId} onChange={(e) => onUser(e.target.value)}>
            <option value="alex">Alex Builder</option>
            <option value="sam">Sam Maker</option>
          </select>
          <label htmlFor="share-scenario">Account scenario</label>
          <select
            id="share-scenario"
            value={scenario}
            onChange={(e) => onScenario(e.target.value as Scenario)}
          >
            <option value="empty">No linked events</option>
            <option value="one">One open event</option>
            <option value="several">Several open events</option>
            <option value="inactive">Past and future only</option>
            <option value="unfinished">Unfinished work across devices</option>
            <option value="history">Projects grouped by event</option>
          </select>
          <Button variant="quiet" onClick={onExpire}>
            Expire session (fixture)
          </Button>
          <Button variant="quiet" onClick={onReset}>
            Reset preview
          </Button>
        </div>
        <div className="access-fixture-actions">
          <label htmlFor="share-clock">Fixture time</label>
          <select id="share-clock" value={clock} onChange={(e) => onTime(e.target.value)}>
            <option value="2026-11-09T17:30:00Z">9 Nov · 18:30 Prague</option>
            <option value="2026-11-09T15:59:59Z">Just before Demo Night opens</option>
            <option value="2026-11-09T16:00:00Z">Exactly at opening</option>
            <option value="2026-11-10T17:00:00Z">Exactly at closing</option>
          </select>
          <Button variant="quiet" onClick={onClose}>
            Close selected event (fixture)
          </Button>
          <Button variant="quiet" onClick={onSuspend}>
            Suspend selected event (fixture)
          </Button>
        </div>
        <div className="access-fixture-actions">
          {sampleEvents.map((event) => (
            <Button key={event.id} variant="quiet" onClick={() => onScan(event.id)}>
              Scan {event.title} (fixture)
            </Button>
          ))}
          <Button variant="quiet" onClick={onCameraDenied}>
            Simulate camera denial
          </Button>
          <Button variant="quiet" onClick={onOffline}>
            Fail next event request
          </Button>
          <Button variant="quiet" onClick={onSaveFailure}>
            Fail next save
          </Button>
        </div>
        <p>
          Example links: luma.com/sample-demo-night or luma.com/blxy7j09. Both represent fictional
          Demo Night here; no live whitelist check is made. https:// is optional and lu.ma is also
          accepted.
        </p>
        <div className="access-fixture-actions">
          <label htmlFor="share-language">Pitch language</label>
          <select
            id="share-language"
            value={language}
            onChange={(e) => onLanguage(e.target.value as "sk" | "cs" | "en")}
          >
            <option value="sk">Slovak</option>
            <option value="cs">Czech</option>
            <option value="en">English</option>
          </select>
          <Button variant="quiet" disabled={!recording} onClick={onWarning}>
            Simulate 25-second reminder
          </Button>
          <Button variant="quiet" disabled={!recording} onClick={onLimit}>
            Simulate 30-second limit
          </Button>
        </div>
        <div className="access-fixture-actions">
          <Button variant="quiet" onClick={onUpgrade}>
            Simulate upgrade required
          </Button>
          <Button variant="quiet" onClick={onBlockedAuth}>
            Simulate blocked sign-in window
          </Button>
          <Button variant="quiet" disabled={!processing} onClick={onFailProcessing}>
            Fail pitch processing
          </Button>
          <Button variant="quiet" disabled={!savedProject} onClick={onStaleAgent}>
            Simulate stale agent write
          </Button>
          {recoveryMode && (
            <>
              <Button variant="quiet" onClick={() => onReauthReady(false)}>
                Sign in as same account in other tab (fixture)
              </Button>
              <Button variant="quiet" onClick={() => onReauthReady(true)}>
                Sign in as other account in other tab (fixture)
              </Button>
            </>
          )}
        </div>
        <AgentSimulationControls simulation={agentSimulation} />
        <a href="#catalogue">Back to catalogue</a>
      </details>
      {providerPending && (
        <div className="access-fixture-actions">
          <Button onClick={onLogin}>Simulate successful sign-in</Button>
          <Button variant="quiet" onClick={onLoginFailure}>
            Simulate sign-in failure
          </Button>
        </div>
      )}
    </aside>
  );
}
