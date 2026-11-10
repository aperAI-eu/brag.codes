import type { Project } from "../../app/src/ui/model";

export const projects: Project[] = [
  {
    id: "fieldnotes",
    title: "Fieldnotes",
    tagline: "Site inspections that keep working when the internet doesn't.",
    problem:
      "Inspectors were taking photos on site, then rebuilding their reports from memory back at the office. Most sites had unreliable mobile coverage.",
    description:
      "A small browser app for notes, photos and checklists. Everything is captured locally and uploaded when a connection returns. I built it for a friend's two-person inspection team, and they now use it on every visit.",
    takeaway: "An upload queue that survives browser restarts.",
    limitation:
      "Made for one inspector per report. It does not merge simultaneous edits from multiple devices.",
    tags: ["Offline-first", "TypeScript", "IndexedDB"],
    source: "private",
    intent: "pattern",
    status: "Daily use",
    event: "bratislava",
    author: {
      name: "Mira Novak",
      role: "Frontend developer · Bratislava",
      contact: "mira@example.com",
      contactKind: "email",
      color: "#e9e0d5",
    },
    color: "#e8eddf",
    symbol: "layers",
    feedback: true,
  },
  {
    id: "room-for-thought",
    title: "Room for thought",
    tagline: "Turn a scattered week of voice notes into one clear reflection.",
    problem:
      "My best ideas were spread across voice memos, notebooks and messages to myself. At the end of the week, I couldn't see the connections.",
    description:
      "An intentionally small ritual: collect your notes, see recurring themes, and choose one idea to carry into next week. I described the workflow first and used a coding agent to help turn it into a simple app.",
    takeaway: "Ask for recurring questions, not just a summary.",
    limitation:
      "The suggested themes need a human review. It is a personal experiment, not a transcription service.",
    tags: ["Personal tools", "Reflection", "Voice"],
    source: "description",
    intent: "tool",
    status: "Prototype",
    event: "bratislava",
    author: {
      name: "Tomas Urban",
      role: "Designer who builds",
      contact: "tomas@example.com",
      contactKind: "email",
      color: "#dce4ec",
    },
    color: "#e8e4f0",
    symbol: "wave",
    feedback: true,
  },
  {
    id: "replay",
    title: "Replay",
    tagline: "Reproduce the agent run that worked. Or the one that really didn't.",
    problem:
      "When an agent failed in CI, the logs showed what happened but gave us no reliable way to recreate it.",
    description:
      "A tool-call recorder that stores requests and results in SQLite. Replay a run using recorded responses, then change one step at a time to understand why it broke.",
    takeaway: "Debug agent failures with recorded tool responses.",
    limitation:
      "Replay reproduces recorded responses, not real-world side effects or model determinism.",
    tags: ["Agent tooling", "SQLite", "Debugging"],
    source: "public",
    intent: "pattern",
    status: "Daily use",
    event: "bratislava",
    author: {
      name: "Adam Kovac",
      role: "Engineer · agent systems",
      contact: "adam@example.com",
      contactKind: "email",
      color: "#f0dacd",
    },
    color: "#f3e5d6",
    symbol: "loop",
    feedback: false,
  },
  {
    id: "patchwork",
    title: "Patchwork",
    tagline: "A shared workshop inventory for people who would rather make things.",
    problem:
      "Nobody at our makerspace knew whether we had another box of M3 bolts. Buying duplicates was easier than finding things.",
    description:
      "A searchable inventory with a location and a photo for each item. Scan the shelf label, see what's there, and leave a quick note when a supply is running low.",
    takeaway: "Start with the shelf location. Categories can wait.",
    limitation:
      "Stock counts are approximate. It works because people maintain it, not because it tracks everything automatically.",
    tags: ["Community", "Inventory", "QR codes"],
    source: "description",
    intent: "tool",
    status: "Daily use",
    event: "bratislava",
    author: {
      name: "Lea Fischer",
      role: "Maker · community organizer",
      contact: "lea@example.com",
      contactKind: "email",
      color: "#e2e8d8",
    },
    color: "#e1e9ec",
    symbol: "grid",
    feedback: true,
  },
  {
    id: "tiny-receipts",
    title: "Tiny receipts",
    tagline: "The boring part of a side project, a little less boring.",
    problem:
      "Monthly receipt collection meant hunting through email threads and naming files by hand.",
    description:
      "A small inbox-to-folder workflow that proposes a date, vendor and amount, then asks me to check the fields before filing. It does one narrow job and leaves the bookkeeping to my accountant.",
    takeaway: "A review queue beats confident guessing.",
    limitation: "Not accounting software. Tax treatment and extracted amounts still need checking.",
    tags: ["Workflow", "Documents", "Human review"],
    source: "private",
    intent: "tool",
    status: "Prototype",
    event: "bratislava",
    author: {
      name: "Nina Malik",
      role: "Indie builder",
      contact: "nina@example.com",
      contactKind: "email",
      color: "#efe1dc",
    },
    color: "#f0e5dd",
    symbol: "paper",
    feedback: true,
  },
  {
    id: "seedling",
    title: "Seedling",
    tagline: "A quieter way to keep your small garden alive.",
    problem:
      "Generic plant reminders ignored the weather and told me to water after a day of rain.",
    description:
      "A garden notebook with simple weather-aware reminders. I started with three balcony plants and a tiny set of rules that I could actually explain.",
    takeaway: "Small, explainable rules can be enough.",
    limitation:
      "Designed for my own balcony conditions. Plant advice is a personal observation rather than expert guidance.",
    tags: ["Personal tools", "Weather", "Automation"],
    source: "description",
    intent: "tool",
    status: "Early idea",
    event: "bratislava",
    author: {
      name: "Oliver Weiss",
      role: "Developer · balcony gardener",
      contact: "oliver@example.com",
      contactKind: "email",
      color: "#e7dfca",
    },
    color: "#e5ecdf",
    symbol: "leaf",
    feedback: true,
  },
  {
    id: "handoff",
    title: "Handoff",
    tagline: "Leave your next coding session a useful starting point.",
    problem:
      "Every new agent session needed the same explanation of what had been decided and what was still uncertain.",
    description:
      "A short, reviewed handoff note generated at the end of a session. It separates decisions, evidence and open questions so the next session starts with context rather than a transcript dump.",
    takeaway: "Capture decisions and their reasons separately.",
    limitation:
      "The human still needs to check the handoff. Incorrect context otherwise carries forward.",
    tags: ["Agent tooling", "Workflow", "Context"],
    source: "public",
    intent: "pattern",
    status: "Prototype",
    event: "vienna",
    author: {
      name: "Eva Lang",
      role: "Software engineer · Vienna",
      contact: "eva@example.com",
      contactKind: "email",
      color: "#e1e2ed",
    },
    color: "#e5e5ed",
    symbol: "terminal",
    feedback: true,
  },
  {
    id: "little-index",
    title: "Little index",
    tagline: "Find the useful paragraph in your own reading pile.",
    problem:
      "Bookmarks tell me where I saved something, but not why it mattered to the problem I'm solving now.",
    description:
      "A personal reading index that stores a short note alongside each saved article. Search matches my own notes first, and always returns the original source.",
    takeaway: "Index why you saved something, not just its title.",
    limitation:
      "Only as useful as the notes you add. There is no private browsing history collection.",
    tags: ["Search", "Knowledge", "Personal tools"],
    source: "description",
    intent: "pattern",
    status: "Prototype",
    event: "vienna",
    author: {
      name: "Lukas Berg",
      role: "Curious builder · Vienna",
      contact: "lukas@example.com",
      contactKind: "email",
      color: "#e6e1d4",
    },
    color: "#f0ead9",
    symbol: "spark",
    feedback: false,
  },
];

export interface Draft {
  title: string;
  problem: string;
  description: string;
  takeaway: string;
  limitation: string;
  name: string;
  contact: string;
  contactKind: "email" | "profile";
  recoveryEmail: string;
  source: "description" | "private";
}

export const emptyDraft: Draft = {
  title: "",
  problem: "",
  description: "",
  takeaway: "",
  limitation: "",
  name: "",
  contact: "",
  contactKind: "email",
  recoveryEmail: "",
  source: "description",
};

export const repositorySuggestion = {
  title: "Pocket queue",
  problem: "Photos and notes from field visits were lost whenever the mobile connection dropped.",
  description:
    "A browser upload queue that saves work on the device, retries when a connection returns, and uses idempotency keys to avoid duplicate uploads.",
  takeaway: "Durable retries with idempotency keys.",
  limitation: "Concurrent edits across devices are not merged.",
};

// Deliberately allowlisted: neither recovery email nor private repo metadata can enter a public card/export.
export function publishPreview(draft: Draft): Project {
  return {
    id: "your-project",
    title: draft.title.trim(),
    tagline: draft.problem.trim(),
    problem: draft.problem.trim(),
    description: draft.description.trim(),
    takeaway: draft.takeaway.trim() || "Ask the author about the idea behind this project.",
    limitation: draft.limitation.trim(),
    tags: ["Just shared"],
    source: draft.source,
    intent: "tool",
    status: "Prototype",
    event: "bratislava",
    author: {
      name: draft.name.trim(),
      role: "Builder at AI Builders Bratislava",
      contact: draft.contact.trim(),
      contactKind: draft.contactKind,
      color: "#f0ddcf",
    },
    color: "#f2dfd6",
    symbol: "spark",
    feedback: true,
  };
}
