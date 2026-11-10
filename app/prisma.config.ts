import { defineConfig } from "prisma/config";
import { readSecret, databaseUrl } from "./src/lib/config/secrets.ts";

const file = process.env.MIGRATION_DATABASE_URL_FILE;
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(file
    ? {
        datasource: {
          url: databaseUrl(await readSecret("MIGRATION_DATABASE_URL_FILE", file), "brag_migrator"),
        },
      }
    : {}),
});
