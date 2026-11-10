import { validLanguage } from "../../projects/language.ts";
import { randomUUID } from "node:crypto";
import {
  AUDIO_RATE,
  MAX_AUDIO_BYTES,
  emptyDetails,
  type ProjectFields,
  type ProjectDetails,
  type ProjectPattern,
  type Proposal,
} from "../../projects/model.ts";
import { uuid } from "../events/validation.ts";
export class ProjectError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw new ProjectError(400, "invalid_request");
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number): string {
  if (
    typeof value !== "string" ||
    [...value].length > limit ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new ProjectError(422, "invalid_fields");
  return value.trim();
}
function list(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new ProjectError(422, "invalid_fields");
  return [...new Set(value.map((v) => text(v, 300)).filter(Boolean))];
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value === null) return null;
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new ProjectError(422, "invalid_fields");
  return value as T;
}
export function details(value: unknown): ProjectDetails {
  const d = object(value, Object.keys(emptyDetails));
  const process = object(d.process, Object.keys(emptyDetails.process));
  if (!Array.isArray(d.patterns) || d.patterns.length > 8)
    throw new ProjectError(422, "invalid_fields");
  const patterns: ProjectPattern[] = d.patterns.map((v) => {
    const p = object(v, ["id", "kind", "name", "description", "evidence", "source"]);
    if (
      !uuid(p.id) ||
      !["system", "process"].includes(p.kind as string) ||
      !["author_reported", "agent_inferred"].includes(p.source as string)
    )
      throw new ProjectError(422, "invalid_fields");
    return {
      id: p.id as string,
      kind: p.kind as ProjectPattern["kind"],
      name: text(p.name, 120),
      description: text(p.description, 2000),
      evidence: text(p.evidence, 1000),
      source: p.source as ProjectPattern["source"],
    };
  });
  if (new Set(patterns.map((p) => p.id)).size !== patterns.length)
    throw new ProjectError(422, "invalid_fields");
  if (
    process.agent_share !== null &&
    (!Number.isInteger(process.agent_share) ||
      Number(process.agent_share) < 0 ||
      Number(process.agent_share) > 100)
  )
    throw new ProjectError(422, "invalid_fields");
  if (d.can_demo !== null && typeof d.can_demo !== "boolean")
    throw new ProjectError(422, "invalid_fields");
  return {
    core_idea: text(d.core_idea, 1000),
    capabilities: list(d.capabilities),
    constraints: list(d.constraints),
    limitations: list(d.limitations),
    stack: list(d.stack),
    patterns,
    process: {
      tools: list(process.tools),
      workflow: text(process.workflow, 2000),
      hours_bucket: choice(process.hours_bucket, ["under_2", "2_8", "8_40", "over_40"] as const),
      agent_share: process.agent_share as number | null,
      gotchas: text(process.gotchas, 3000),
      would_build_again: choice(process.would_build_again, ["yes", "differently", "no"] as const),
    },
    reality_level: choice(d.reality_level, [
      "idea",
      "prototype",
      "daily_driver",
      "production",
    ] as const),
    looking_for: list(d.looking_for),
    can_demo: d.can_demo as boolean | null,
    code_license: text(d.code_license, 300),
    catalogue_text_permission: text(d.catalogue_text_permission, 1000),
  };
}
export function fields(value: unknown): ProjectFields {
  const limits = {
    title: 120,
    problem: 1000,
    description: 10000,
    project_url: 2048,
    repository_url: 2048,
  } as const;
  const data = object(value, [...Object.keys(limits), "schema_version", "details", "language"]);
  if (data.schema_version !== 1) throw new ProjectError(422, "invalid_fields");
  const base = {} as Pick<ProjectFields, keyof typeof limits>;
  for (const [key, limit] of Object.entries(limits)) {
    base[key as keyof typeof limits] = text(data[key], limit);
    if (key.endsWith("_url") && base[key as keyof typeof limits]) {
      try {
        const url = new URL(base[key as keyof typeof limits]);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          !url.hostname ||
          /[\r\n]/.test(data[key] as string)
        )
          throw new Error();
      } catch {
        throw new ProjectError(422, "invalid_links");
      }
    }
  }
  if (data.language != null && !validLanguage(data.language))
    throw new ProjectError(422, "invalid_fields");
  const result: ProjectFields = {
    schema_version: 1,
    ...base,
    details: details(data.details),
    ...(data.language !== undefined ? { language: data.language as string | null } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 60000)
    throw new ProjectError(422, "invalid_fields");
  return result;
}
/** Model output cannot assign IDs or claim independently checked provenance. */
export function proposal(value: unknown): Proposal {
  const data = object(value, ["title", "problem", "description", "details", "language"]);
  // New model output must explicitly identify the source or say it is indeterminate.
  if (!validLanguage(data.language)) throw new ProjectError(422, "invalid_fields");
  const proposed = object(data.details, Object.keys(emptyDetails));
  if (!Array.isArray(proposed.patterns) || proposed.patterns.length > 8)
    throw new ProjectError(422, "invalid_fields");
  const patterns = proposed.patterns.map((v) => {
    const pattern = object(v, ["kind", "name", "description", "evidence"]);
    return { ...pattern, id: randomUUID(), source: "author_reported" };
  });
  const {
    title,
    problem,
    description,
    details: parsed,
  } = fields({
    ...data,
    schema_version: 1,
    project_url: "",
    repository_url: "",
    details: { ...proposed, patterns },
  });
  return { title, problem, description, details: parsed, language: data.language };
}
/** Only canonical mono PCM WAV from our recorder. Duration is derived from decoded sample bytes. */
export function validateAudio(bytes: Buffer, maxSeconds = 30) {
  if (bytes.length > Math.min(MAX_AUDIO_BYTES, 44 + maxSeconds * AUDIO_RATE * 2))
    throw new ProjectError(413, "pitch_too_long");
  if (
    bytes.length < 46 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.toString("ascii", 8, 16) !== "WAVEfmt " ||
    bytes.readUInt32LE(16) !== 16 ||
    bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 1 ||
    bytes.readUInt32LE(24) !== AUDIO_RATE ||
    bytes.readUInt32LE(28) !== AUDIO_RATE * 2 ||
    bytes.readUInt16LE(32) !== 2 ||
    bytes.readUInt16LE(34) !== 16 ||
    bytes.toString("ascii", 36, 40) !== "data" ||
    bytes.readUInt32LE(40) !== bytes.length - 44 ||
    (bytes.length - 44) % 2
  )
    throw new ProjectError(415, "invalid_audio");
  return (bytes.length - 44) / (AUDIO_RATE * 2);
}
