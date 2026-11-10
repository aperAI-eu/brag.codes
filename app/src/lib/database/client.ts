import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { runtimeConfig } from "../config/runtime.ts";

export function createDatabase(connectionString: string) {
  const adapter = new PrismaPg(
    {
      connectionString,
      max: 4,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      query_timeout: 2500,
      statement_timeout: 2000,
    },
    { schema: "brag" },
  );
  return new PrismaClient({ adapter });
}

const state = globalThis as unknown as {
  bragDatabase?: Promise<ReturnType<typeof createDatabase>>;
};
export async function database() {
  state.bragDatabase ??= runtimeConfig().then((config) => createDatabase(config.databaseUrl));
  return state.bragDatabase;
}
