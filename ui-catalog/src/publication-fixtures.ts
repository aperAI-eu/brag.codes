import type { ProjectFields } from "../../app/src/projects/model";
import type { PublicationChoices, PublicProjectContent } from "../../app/src/ui/publication";
import { fictionalPitch } from "./sharing-fixtures";

export function sampleProject(): ProjectFields {
  const project = fictionalPitch("en");
  return {
    ...project,
    details: { ...project.details, capabilities: ["Search notes offline."] },
    project_url: "https://example.com/offline-notes",
    repository_url: "https://example.com/private/offline-notes",
  };
}
// Fictional projection only. Runtime must construct and authorize its own allowlist.
export function previewProjection(
  fields: ProjectFields,
  choices: PublicationChoices,
): PublicProjectContent {
  const d = fields.details,
    p = d.process;
  const optional = [
    ["Core idea", d.core_idea],
    ["Capabilities", d.capabilities.join("\n")],
    ["Constraints", d.constraints.join("\n")],
    ["Limitations", d.limitations.join("\n")],
    ["Stack", d.stack.join(", ")],
    ["Maturity", d.reality_level?.replaceAll("_", " ") ?? ""],
    [
      "Patterns",
      d.patterns
        .map(
          (v) =>
            `${v.name} (${v.kind}, ${v.source.replaceAll("_", " ")})\n${v.description}${v.evidence ? `\n${v.evidence}` : ""}`,
        )
        .join("\n\n"),
    ],
    ["Tools", p.tools.join(", ")],
    ["Workflow", p.workflow],
    [
      "Effort",
      p.hours_bucket
        ? {
            under_2: "Under 2 hours",
            "2_8": "2–8 hours",
            "8_40": "8–40 hours",
            over_40: "Over 40 hours",
          }[p.hours_bucket]
        : "",
    ],
    ["Agent contribution", p.agent_share === null ? "" : `${p.agent_share}%`],
    ["Gotchas", p.gotchas],
    ["Would build again", p.would_build_again ?? ""],
    ["Looking for", d.looking_for.join(", ")],
    ["Demo available", d.can_demo === null ? "" : d.can_demo ? "Yes" : "No"],
    ["Code licence", d.code_license],
    ["Catalogue text permission", d.catalogue_text_permission],
  ];
  return {
    title: fields.title,
    problem: fields.problem,
    description: fields.description,
    event: "Bratislava Demo Night",
    language: fields.language ?? null,
    author: {
      name: choices.name.trim(),
      contact: choices.contact.trim(),
      href:
        choices.contactKind === "email"
          ? `mailto:${choices.contact.trim()}`
          : choices.contact.trim(),
    },
    links: [
      ...(choices.includeProjectLink && fields.project_url
        ? [{ label: "Project link", url: fields.project_url }]
        : []),
      ...(choices.includeRepositoryLink && fields.repository_url
        ? [{ label: "Repository link", url: fields.repository_url }]
        : []),
    ],
    sections: choices.includeDetails
      ? optional.filter(([, text]) => text.trim()).map(([label, text]) => ({ label, text }))
      : [],
  };
}
export function validContact(value: PublicationChoices): boolean {
  if (!value.name.trim()) return false;
  if (value.contactKind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.contact.trim());
  try {
    const url = new URL(value.contact);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function safePublicLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
