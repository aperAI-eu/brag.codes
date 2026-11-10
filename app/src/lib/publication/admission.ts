import "server-only";
import type { Tx } from "../sharing/admission.ts";
export async function recordAdmission(
  tx: Tx,
  id: string,
  owner: string,
  source: "typed" | "voice" | "agent" | "publication_review",
  reference: string,
) {
  await tx.$queryRaw`SELECT brag.admit_project(${id}::uuid,${owner},${source},${reference}::uuid)::text`;
}
