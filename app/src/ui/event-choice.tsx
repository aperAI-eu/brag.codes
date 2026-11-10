import { Button, Icon } from "./components";
import type { LinkedEvent } from "./share-work";

export function EventChoiceView({
  events,
  retained,
  onScan,
  onWithoutEvent,
  onSelect,
  onResume,
  onDiscard,
}: {
  events: LinkedEvent[];
  retained: boolean;
  onScan: () => void;
  onWithoutEvent: () => void;
  onSelect: (event: LinkedEvent) => void;
  onResume: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="access-card">
      <p className="eyebrow">SHARE YOUR WORK</p>
      <h1>Sharing at an event?</h1>
      <p className="muted">
        Scan its QR to link your project. You can also share on your own — no event needed.
      </p>
      {retained ? (
        <>
          <p role="status">
            Your unfinished project is retained in this tab, including its event choice.
          </p>
          <div className="event-choice-actions">
            <Button onClick={onResume}>Resume unfinished project</Button>
            <Button variant="secondary" onClick={onDiscard}>
              Discard unfinished project and start again
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="event-choice-actions">
            <Button onClick={onScan}>
              <Icon name="grid" size={20} /> Scan event QR
            </Button>
            <Button variant="secondary" onClick={onWithoutEvent}>
              Continue without an event
            </Button>
          </div>
          {events.length > 0 && (
            <div className="event-choice-list">
              <h2>Or use a linked event</h2>
              {events.map((event) => (
                <Button
                  key={event.id}
                  variant="secondary"
                  disabled={event.state !== "open"}
                  onClick={() => onSelect(event)}
                >
                  {event.title}
                  {event.state !== "open" ? " · Unavailable" : ""}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
export function OptionalEventPreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="secondary" onClick={onOpen}>
      Try optional event sharing
    </Button>
  );
}
