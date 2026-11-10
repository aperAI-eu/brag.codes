import { Button } from "../../app/src/ui/components";
import type { useAgentPreview } from "./use-agent-preview";

export function AgentSimulationControls({
  simulation,
}: {
  simulation: ReturnType<typeof useAgentPreview>["simulation"];
}) {
  if (!simulation.visible) return null;
  return (
    <fieldset className="agent-simulations">
      <legend>Agent proposal · fictional credential, no real upload</legend>
      <div className="access-fixture-actions">
        <Button variant="quiet" disabled={!simulation.canForget} onClick={simulation.onForget}>
          Simulate missing instructions
        </Button>
        <Button variant="quiet" disabled={!simulation.canUpload} onClick={simulation.onUpload}>
          Simulate proposal upload
        </Button>
        <Button
          variant="quiet"
          disabled={!simulation.canDuplicate}
          onClick={simulation.onDuplicate}
        >
          Simulate duplicate upload
        </Button>
        <Button variant="quiet" disabled={!simulation.canExpire} onClick={simulation.onExpire}>
          Expire upload instructions
        </Button>
        <Button
          variant="quiet"
          disabled={!simulation.canInterrupt}
          onClick={simulation.onInterrupt}
        >
          Interrupt status check
        </Button>
      </div>
    </fieldset>
  );
}
