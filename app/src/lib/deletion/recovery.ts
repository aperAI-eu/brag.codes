import type pg from "pg";
export type DeletionLedger = {
  format: 1;
  environment: string;
  exported_at: string;
  deletions: {
    project_id: string;
    owner_id: string;
    key: string;
    expected_version: number;
    expected_published: boolean;
    deleted_at: string;
  }[];
};
const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const environments = ["local", "test", "production"];
export async function exportDeletionLedger(
  db: pg.Client,
  environment: string,
): Promise<DeletionLedger> {
  if (!environments.includes(environment)) throw new Error("Invalid recovery environment");
  const rows = await db.query(
    "SELECT project_id,owner_id,key,expected_version,expected_published,to_char(deleted_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS deleted_at FROM brag.project_deletion ORDER BY project_id",
  );
  return { format: 1, environment, exported_at: new Date().toISOString(), deletions: rows.rows };
}
export function validateDeletionLedger(input: unknown, environment: string): DeletionLedger {
  const ledger = input as DeletionLedger;
  if (
    !environments.includes(environment) ||
    !ledger ||
    ledger.format !== 1 ||
    ledger.environment !== environment ||
    typeof ledger.exported_at !== "string" ||
    !Number.isFinite(Date.parse(ledger.exported_at)) ||
    !Array.isArray(ledger.deletions) ||
    ledger.deletions.length > 100000
  )
    throw new Error("Invalid deletion ledger");
  const ids = new Set(),
    keys = new Set();
  for (const row of ledger.deletions) {
    if (
      !row ||
      !identifier.test(row.project_id) ||
      !identifier.test(row.key) ||
      typeof row.owner_id !== "string" ||
      row.owner_id.length < 1 ||
      row.owner_id.length > 255 ||
      !Number.isSafeInteger(row.expected_version) ||
      row.expected_version < 1 ||
      row.expected_version > 2147483647 ||
      typeof row.expected_published !== "boolean" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(row.deleted_at) ||
      !Number.isFinite(Date.parse(row.deleted_at)) ||
      Date.parse(row.deleted_at) > Date.parse(ledger.exported_at) + 1000 ||
      ids.has(row.project_id) ||
      keys.has(JSON.stringify([row.owner_id, row.key]))
    )
      throw new Error("Invalid deletion ledger entry");
    ids.add(row.project_id);
    keys.add(JSON.stringify([row.owner_id, row.key]));
  }
  return ledger;
}
/** Recovery caller must isolate the target, establish ledger completeness and use migrator. */
export async function replayDeletionLedger(db: pg.Client, input: unknown, environment: string) {
  const ledger = validateDeletionLedger(input, environment);
  await db.query("BEGIN");
  try {
    await db.query("LOCK TABLE brag.project_deletion IN SHARE ROW EXCLUSIVE MODE");
    for (const row of ledger.deletions) {
      const args = [
        row.project_id,
        row.owner_id,
        row.key,
        row.expected_version,
        row.expected_published,
        row.deleted_at,
      ];
      const previous = await db.query(
        "SELECT project_id FROM brag.project_deletion WHERE project_id=$1 OR (owner_id=$2 AND key=$3)",
        args.slice(0, 3),
      );
      if (previous.rowCount) {
        const exact = await db.query(
          "SELECT project_id FROM brag.project_deletion WHERE project_id=$1 AND owner_id=$2 AND key=$3 AND expected_version=$4 AND expected_published=$5 AND deleted_at=$6::timestamptz",
          args,
        );
        if (exact.rowCount !== 1 || previous.rowCount !== 1)
          throw new Error("Conflicting deletion ledger");
      } else
        await db.query(
          "INSERT INTO brag.project_deletion(project_id,owner_id,key,expected_version,expected_published,deleted_at) VALUES($1,$2,$3,$4,$5,$6)",
          args,
        );
      await db.query("SELECT brag.purge_deleted_project($1)", [row.project_id]);
    }
    await db.query("COMMIT");
    return { replayed: ledger.deletions.length };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
