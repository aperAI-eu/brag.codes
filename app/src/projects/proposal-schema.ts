// Provider output is validated again by the shared server validator. This schema
// intentionally excludes identity, links, pattern IDs and provenance authority.
const string = { type: "string" };
const strings = { type: "array", items: string };
const nullableChoice = (values: string[]) => ({
  anyOf: [{ type: "string", enum: values }, { type: "null" }],
});
function object(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
export const proposalSchema = object({
  language: {
    type: "string",
    description:
      "Detected source language: sk (Slovak), cs (Czech), en (English), or another canonical BCP 47 language code. Use und when indeterminate, mul for mixed speech with no dominant language. This never selects a translation language.",
  },
  title: string,
  problem: string,
  description: string,
  details: object({
    core_idea: string,
    capabilities: strings,
    constraints: strings,
    limitations: strings,
    stack: strings,
    patterns: {
      type: "array",
      items: object({
        kind: { type: "string", enum: ["system", "process"] },
        name: string,
        description: string,
        evidence: string,
      }),
    },
    process: object({
      tools: strings,
      workflow: string,
      hours_bucket: nullableChoice(["under_2", "2_8", "8_40", "over_40"]),
      agent_share: { type: ["integer", "null"] },
      gotchas: string,
      would_build_again: nullableChoice(["yes", "differently", "no"]),
    }),
    reality_level: nullableChoice(["idea", "prototype", "daily_driver", "production"]),
    looking_for: strings,
    can_demo: { type: ["boolean", "null"] },
    code_license: string,
    catalogue_text_permission: string,
  }),
});
