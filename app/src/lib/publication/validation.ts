import { object, ProjectError } from "../projects/validation.ts";
export type Selection = {
  public_author: { display_name: string; contact: { kind: "email" | "profile"; value: string } };
  include: { project_link: boolean; repository_link: boolean; details: boolean };
};
export function httpsUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !/[\s\u0000-\u001f\u007f]/.test(value)
    );
  } catch {
    return false;
  }
}
export function lifecycleVersion(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > 2147483646)
    throw new ProjectError(400, "invalid_request");
  return Number(value);
}
export function selection(
  input: unknown,
): Selection & { expected_version: number; expected_publication_revision: number } {
  const d = object(input, [
    "expected_version",
    "expected_publication_revision",
    "public_author",
    "include",
  ]);
  const a = object(d.public_author, ["display_name", "contact"]);
  const c = object(a.contact, ["kind", "value"]);
  const i = object(d.include, ["project_link", "repository_link", "details"]);
  if (!Number.isSafeInteger(d.expected_version) || Number(d.expected_version) < 1)
    throw new ProjectError(400, "invalid_request");
  if (
    typeof a.display_name !== "string" ||
    !a.display_name.trim() ||
    [...a.display_name].length > 100 ||
    /[\u0000-\u001f\u007f]/.test(a.display_name)
  )
    throw new ProjectError(422, "invalid_public_author");
  if (
    typeof c.value !== "string" ||
    !c.value.trim() ||
    c.value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(c.value)
  )
    throw new ProjectError(422, "invalid_public_contact");
  const value = c.value.trim();
  // A single plain mailbox, never a display-name list, URI query or mail header.
  if (
    c.kind === "email"
      ? !/^[A-Za-z0-9.!#$%&'*+/=^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(
          value,
        ) || value.length > 254
      : c.kind !== "profile" || !httpsUrl(value)
  )
    throw new ProjectError(422, "invalid_public_contact");
  if (
    typeof i.project_link !== "boolean" ||
    typeof i.repository_link !== "boolean" ||
    typeof i.details !== "boolean"
  )
    throw new ProjectError(400, "invalid_request");
  return {
    expected_version: lifecycleVersion(d.expected_version, 1),
    expected_publication_revision: lifecycleVersion(d.expected_publication_revision ?? 0),
    public_author: {
      display_name: a.display_name.trim(),
      contact: { kind: c.kind as "email" | "profile", value },
    },
    include: {
      project_link: i.project_link,
      repository_link: i.repository_link,
      details: i.details,
    },
  };
}
