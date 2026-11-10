import type { ProjectFields } from "../../projects/model.ts";
import type { PublicProjectContent } from "../../publication/model.ts";
import { ProjectError } from "../projects/validation.ts";
import { httpsUrl, type Selection } from "./validation.ts";
/** Explicit allowlist; never spread a private record into public output. */
export function publicProjection(
  fields: ProjectFields,
  choice: Selection,
  event: string | null,
): PublicProjectContent {
  if (!fields.title || !fields.problem || !fields.description)
    throw new ProjectError(422, "required_project_fields");
  if (
    (choice.include.project_link && (!fields.project_url || !httpsUrl(fields.project_url))) ||
    (choice.include.repository_link && (!fields.repository_url || !httpsUrl(fields.repository_url)))
  )
    throw new ProjectError(422, "invalid_links");
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
    event,
    language: fields.language ?? null,
    author: {
      name: choice.public_author.display_name,
      contact: choice.public_author.contact.value,
      href:
        choice.public_author.contact.kind === "email"
          ? `mailto:${encodeURIComponent(choice.public_author.contact.value)}`
          : choice.public_author.contact.value,
    },
    links: [
      ...(choice.include.project_link && fields.project_url
        ? [{ label: "Project link", url: fields.project_url }]
        : []),
      ...(choice.include.repository_link && fields.repository_url
        ? [{ label: "Repository link", url: fields.repository_url }]
        : []),
    ],
    sections: choice.include.details
      ? optional.filter(([, text]) => text.trim()).map(([label, text]) => ({ label, text }))
      : [],
  };
}
