import type { AccountSummary } from "../../app/src/ui/access";
import type { LinkedEvent, OwnProject, ShareDestination } from "../../app/src/ui/share-work";
import { emptyProject, type ProjectFields } from "../../app/src/projects/model";
import { normalizePastedEventLink } from "../../app/src/events/event-link";

export const fixtureTime = "2026-11-09T17:30:00Z";
export const sampleEvents = [
  {
    id: "demo-night",
    title: "Bratislava Demo Night",
    startsAt: "2026-11-09T17:00:00Z",
    opensAt: "2026-11-09T16:00:00Z",
    closesAt: "2026-11-10T17:00:00Z",
    location: "Bratislava · Campus",
    url: "https://luma.com/sample-demo-night",
  },
  {
    id: "builders",
    title: "Prague Builders",
    startsAt: "2026-11-09T18:00:00Z",
    opensAt: "2026-11-09T17:00:00Z",
    closesAt: "2026-11-10T18:00:00Z",
    location: "Prague · Studio",
    url: "https://luma.com/sample-builders",
  },
  {
    id: "past",
    title: "October Maker Meetup",
    startsAt: "2026-10-15T17:00:00Z",
    opensAt: "2026-10-15T16:00:00Z",
    closesAt: "2026-10-16T17:00:00Z",
    location: "Brno · Makerspace",
    url: "https://luma.com/sample-past",
  },
  {
    id: "future",
    title: "Winter Build Club",
    startsAt: "2026-12-01T17:00:00Z",
    opensAt: "2026-12-01T16:00:00Z",
    closesAt: "2026-12-02T17:00:00Z",
    location: "Bratislava · Campus",
    url: "https://luma.com/sample-future",
  },
];
/** Explicit catalogue aliases only; never look up live events from this preview. */
export function pastedEventFixture(value: string, origin: string): string | null {
  try {
    const { url } = normalizePastedEventLink(value, origin);
    if (url === "https://luma.com/blxy7j09") return "demo-night";
    return sampleEvents.find((event) => event.url === url)?.id ?? null;
  } catch {
    return null;
  }
}
const formatTime = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export function eventViews(now: string, closed: string[], suspended: string[]): LinkedEvent[] {
  return sampleEvents.map((event) => ({
    id: event.id,
    title: event.title,
    location: event.location,
    starts: formatTime(event.startsAt),
    from: formatTime(event.opensAt),
    to: formatTime(event.closesAt),
    timezone: "Europe/Prague",
    state: suspended.includes(event.id)
      ? "suspended"
      : closed.includes(event.id) || now >= event.closesAt
        ? "closed"
        : now < event.opensAt
          ? "scheduled"
          : "open",
  }));
}
export type StoredProject = OwnProject & {
  ownerId: string;
  fields: ProjectFields;
  received?: boolean;
  recovery?: "preparing" | "ready" | "failed";
  transcript?: string;
};
export type Scenario = "empty" | "one" | "several" | "inactive" | "history" | "unfinished";
export function seededAccount(
  scenario: Scenario,
  ownerId: string,
): { links: string[]; projects: StoredProject[] } {
  const links =
    scenario === "empty"
      ? []
      : scenario === "one"
        ? ["demo-night"]
        : scenario === "several"
          ? ["demo-night", "builders"]
          : scenario === "inactive"
            ? ["past", "future"]
            : ["demo-night", "builders", "past"];
  const projects: StoredProject[] =
    scenario !== "history"
      ? []
      : [
          {
            id: `${ownerId}-notes`,
            eventId: "demo-night",
            title: "Offline notes",
            description: "A searchable notebook that works without internet.",
          },
          {
            id: `${ownerId}-garden`,
            eventId: "demo-night",
            title: "Garden sensor",
            description: "A small sensor that reminds me to water my plants.",
          },
          {
            id: `${ownerId}-maps`,
            eventId: "past",
            title: "Weekend maps",
            description: "A collection of short walking routes.",
          },
        ].map((project) => ({
          ...project,
          ownerId,
          saved: true,
          unfinished: false,
          publicationState:
            project.title === "Garden sensor"
              ? ("withdrawn" as const)
              : project.title === "Weekend maps"
                ? ("hidden" as const)
                : null,
          status: "Confirmed",
          method: "Typed" as const,
          updated: "9 Nov, 18:30",
          fields: {
            ...structuredClone(emptyProject),
            title: project.title,
            description: project.description,
            language: "en",
          },
        }));
  if (scenario === "unfinished") {
    const rows: Array<{
      key: string;
      title: string;
      eventId: string;
      method: StoredProject["method"];
      status: string;
      recovery?: StoredProject["recovery"];
      saved?: boolean;
      legacy?: boolean;
      received?: boolean;
    }> = [
      {
        key: "phone",
        title: "Phone garden pitch",
        eventId: "demo-night",
        method: "Voice",
        status: "Ready for review",
        recovery: "ready",
        received: true,
      },
      {
        key: "agent",
        title: "Agent walking maps",
        eventId: "past",
        method: "Agent",
        status: "Ready for review",
        recovery: "ready",
        received: true,
      },
      {
        key: "preparing",
        title: "Saved notes, new pitch",
        eventId: "demo-night",
        method: "Voice",
        status: "Preparing pitch",
        recovery: "preparing",
        saved: true,
        received: true,
      },
      {
        key: "failed",
        title: "Unfinished workshop pitch",
        eventId: "past",
        method: "Voice",
        status: "Pitch failed · recovery available",
        recovery: "failed",
      },
      {
        key: "legacy",
        title: "Existing trail guide",
        eventId: "past",
        method: "Typed",
        status: "Existing draft",
        saved: true,
        legacy: true,
      },
    ];
    projects.push(
      ...rows.map((row): StoredProject => ({
        ...row,
        id: `${ownerId}-${row.key}`,
        ownerId,
        saved: !!row.saved,
        unfinished: !!row.recovery,
        updated: "9 Nov, 18:20",
        transcript:
          row.recovery === "failed"
            ? "I built a workshop booking tool for our community."
            : undefined,
        fields: {
          ...structuredClone(emptyProject),
          title: row.title,
          description: "A fictional project prepared on another device.",
          language: "en",
        },
      })),
    );
  }
  return { links, projects };
}
export function fictionalPitch(language: "sk" | "cs" | "en"): ProjectFields {
  const text = {
    sk: [
      "Poznámky bez internetu",
      "Nájsť poznámky aj bez pripojenia.",
      "Vytvoril som zápisník s vyhľadávaním, ktorý funguje aj bez internetu.",
    ],
    cs: [
      "Poznámky bez internetu",
      "Najít poznámky i bez připojení.",
      "Vytvořil jsem zápisník s vyhledáváním, který funguje i bez internetu.",
    ],
    en: [
      "Offline notes",
      "Find my notes without an internet connection.",
      "I built a searchable notebook that works without internet.",
    ],
  }[language];
  return {
    ...structuredClone(emptyProject),
    title: text[0],
    problem: text[1],
    description: text[2],
    language,
  };
}

export type ShareRoute =
  | ShareDestination
  | "share"
  | "sign-in"
  | "provider"
  | "choose"
  | "linked"
  | "submit"
  | "unfinished"
  | "reauth"
  | "upgrade";
export const shareRoutes: ShareRoute[] = [
  "home",
  "events",
  "projects",
  "account",
  "scan",
  "slop",
  "share",
  "sign-in",
  "provider",
  "choose",
  "linked",
  "submit",
  "unfinished",
  "reauth",
  "upgrade",
];
export const identities: AccountSummary[] = [
  { id: "alex", name: "Alex Builder", email: "alex@example.com" },
  { id: "sam", name: "Sam Maker", email: "sam@example.com" },
];
