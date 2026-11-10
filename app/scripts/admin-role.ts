import { readFile } from "node:fs/promises";
import { createDatabase } from "../src/lib/database/client.ts";
import { databaseUrl, readSecret } from "../src/lib/config/secrets.ts";
import { administerRole } from "../src/lib/administration/roles.ts";

let db: ReturnType<typeof createDatabase> | undefined;
try {
  const environment = process.env.BRAG_ENV;
  if (!["local", "test", "production"].includes(environment || "")) throw new Error();
  db = createDatabase(
    databaseUrl(
      await readSecret("OPERATOR_DATABASE_URL_FILE", process.env.OPERATOR_DATABASE_URL_FILE),
      "brag_operator",
    ),
  );
  const [mode, argument] = process.argv.slice(2);
  if (mode === "inspect" && /^[0-9a-f-]{36}$/i.test(argument || "")) {
    const rows = await db.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
    if (rows[0]?.role !== "brag_operator") throw new Error();
    const user = await db.user.findUnique({
      where: { id: argument },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        active: true,
        platformRole: true,
        accounts: { select: { providerId: true, issuer: true, accountId: true } },
      },
    });
    console.log(JSON.stringify({ environment, user }, null, 2));
  } else if (mode === "apply" && argument) {
    const content = await readFile(argument, "utf8");
    if (content.length > 8192) throw new Error();
    const command = JSON.parse(content);
    const bootstrapEmail =
      command.action === "bootstrap" && command.providerId !== "github"
        ? await readSecret("BOOTSTRAP_GOOGLE_EMAIL_FILE", process.env.BOOTSTRAP_GOOGLE_EMAIL_FILE)
        : undefined;
    const bootstrapUserId =
      command.action === "bootstrap" && command.providerId === "github"
        ? await readSecret("BOOTSTRAP_USER_ID_FILE", process.env.BOOTSTRAP_USER_ID_FILE)
        : undefined;
    console.log(
      JSON.stringify(
        await administerRole(db, command, {
          environment: environment!,
          bootstrapEmail,
          bootstrapUserId,
        }),
      ),
    );
  } else throw new Error();
} catch {
  console.error(
    "Role command refused. Check operator configuration, existing user identity, expected version and request ID. No credentials are printed.",
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
