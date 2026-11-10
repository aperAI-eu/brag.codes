import type { PublicationChoices } from "../ui/publication";
import type { ProjectFields } from "../projects/model";
import type { OwnerPublication } from "./model";

export type Pending =
  | { key: string; action: "publish"; body: { review_id: string } }
  | {
      key: string;
      action: "withdraw";
      body: { expected_version: number; expected_publication_revision: number };
    };
export const initial: PublicationChoices = {
  name: "",
  contactKind: "profile",
  contact: "",
  includeProjectLink: false,
  includeRepositoryLink: false,
  includeDetails: false,
};
const messages: Record<string, string> = {
  version_conflict:
    "This project changed elsewhere. Review the latest state before continuing. Your local edits are retained.",
  review_consumed:
    "This review has already been published. Review the latest state before continuing.",
  review_expired: "This review expired. Edit public details to prepare a fresh preview.",
  publication_restricted: "Publication is restricted. Your private project remains available.",
  event_suspended: "This event is suspended. You can still withdraw or delete your project.",
  invalid_public_contact:
    "Enter one public email address or an HTTPS profile link without sign-in details.",
  invalid_public_author: "Enter a public name of up to 100 characters.",
  invalid_links: "Selected public links must use HTTPS without sign-in details.",
  required_project_fields: "Add a project name, problem and description.",
  rate_limited: "Please wait a minute before trying again.",
};
export class Failure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(messages[code] ?? "Couldn’t confirm this request. Your work is retained; try again.");
  }
}
export function approvedChoices(p: OwnerPublication, f: ProjectFields): PublicationChoices {
  const a = p.selection.public_author;
  const publicUrl = (url: string) => p.public_project.links.some((link) => link.url === url);
  return {
    name: a.display_name,
    contactKind: a.contact.kind,
    contact: a.contact.value,
    includeProjectLink: p.selection.include.project_link && publicUrl(f.project_url),
    includeRepositoryLink: p.selection.include.repository_link && publicUrl(f.repository_url),
    includeDetails: p.selection.include.details,
  };
}
