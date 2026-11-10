import "server-only";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import { withUser } from "../auth/access.ts";
import { lockTarget, owned } from "../sharing/admission.ts";
import { object, ProjectError } from "../projects/validation.ts";
import { uuid } from "../events/validation.ts";
import type { DeletionReceipt, DeletionIntent } from "../../deletion/model.ts";

type Marker = {
  project_id: string;
  owner_id: string;
  key: string;
  expected_version: number;
  expected_published: boolean;
  deleted_at: Date;
};
const receipt = (r: Marker): DeletionReceipt => ({
  project_id: r.project_id,
  deleted: true,
  deleted_at: r.deleted_at.toISOString(),
  receipt: r.key,
});
export function deletionOperations(auth: BragAuth, db: ReturnType<typeof createDatabase>) {
  return {
    remove(headers: Headers, id: string, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        if (!uuid(id)) throw new ProjectError(404, "project_unavailable");
        if (!uuid(key)) throw new ProjectError(400, "idempotency_key_required");
        const data = object(input, ["expected_version", "expected_published"]) as DeletionIntent;
        if (
          !Number.isSafeInteger(data.expected_version) ||
          data.expected_version < 1 ||
          data.expected_version > 2147483647 ||
          typeof data.expected_published !== "boolean"
        )
          throw new ProjectError(400, "invalid_request");
        const [old] = await tx.$queryRaw<
          Marker[]
        >`SELECT * FROM brag.project_deletion WHERE owner_id=${owner} AND key=${key}::uuid`;
        if (old) {
          if (
            old.project_id !== id ||
            old.expected_version !== data.expected_version ||
            old.expected_published !== data.expected_published
          )
            throw new ProjectError(409, "idempotency_conflict");
          return receipt(old);
        }
        const d = await lockTarget(tx, owner, id);
        const rows = await tx.$queryRaw<
          { project_id: string }[]
        >`SELECT project_id FROM brag.project_public_state WHERE project_id=${id}::uuid`;
        if (d.version !== data.expected_version || Boolean(rows.length) !== data.expected_published)
          throw new ProjectError(409, "version_conflict");
        await tx.$queryRaw`SELECT brag.delete_owned_project(${id}::uuid,${owner},${data.expected_version}::integer,${data.expected_published},${key}::uuid)`;
        const [saved] = await tx.$queryRaw<
          Marker[]
        >`SELECT * FROM brag.project_deletion WHERE owner_id=${owner} AND key=${key}::uuid`;
        return receipt(saved);
      });
    },
    receipt(headers: Headers, id: string, key: string) {
      return withUser(auth, db, headers, async (tx, owner) => {
        if (!uuid(id) || !uuid(key)) throw new ProjectError(404, "project_unavailable");
        const [row] = await tx.$queryRaw<
          Marker[]
        >`SELECT * FROM brag.project_deletion WHERE project_id=${id}::uuid AND owner_id=${owner} AND key=${key}::uuid`;
        if (row) return receipt(row);
        await owned(tx, owner, id);
        return { status: "unconfirmed" as const };
      });
    },
  };
}
