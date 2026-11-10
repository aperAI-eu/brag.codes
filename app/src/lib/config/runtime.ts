import { readSecret, databaseUrl } from "./secrets.ts";

export type RuntimeConfig = {
  environment: "local" | "test" | "production";
  origin: string;
  databaseUrl: string;
  authSecret: string;
  google?: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
};
export async function readRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<RuntimeConfig> {
  if (
    env.MIGRATION_DATABASE_URL ||
    env.MIGRATION_DATABASE_URL_FILE ||
    env.POSTGRES_PASSWORD ||
    env.POSTGRES_PASSWORD_FILE ||
    env.DATABASE_URL ||
    env.OPERATOR_DATABASE_URL ||
    env.OPERATOR_DATABASE_URL_FILE ||
    env.BRAG_OPERATOR_PASSWORD ||
    env.BRAG_MIGRATOR_PASSWORD
  ) {
    throw new Error("Web runtime must receive only its DATABASE_URL_FILE credential");
  }
  const environment = env.BRAG_ENV;
  if (environment !== "local" && environment !== "test" && environment !== "production")
    throw new Error("BRAG_ENV must be local, test or production");
  let origin: URL;
  try {
    origin = new URL(env.APP_ORIGIN || "");
    const localHttp =
      environment === "local" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) &&
      origin.protocol === "http:";
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      (origin.protocol !== "https:" && !localHttp)
    )
      throw new Error();
  } catch {
    throw new Error(
      "APP_ORIGIN must be a fixed HTTPS origin (loopback HTTP is allowed only locally)",
    );
  }
  const authSecret = await readSecret("AUTH_SECRET_FILE", env.AUTH_SECRET_FILE);
  if (authSecret.length < 32)
    throw new Error("AUTH_SECRET_FILE must contain at least 32 characters");
  let google: RuntimeConfig["google"];
  if (env.GOOGLE_CLIENT_ID_FILE || env.GOOGLE_CLIENT_SECRET_FILE) {
    const clientId = await readSecret("GOOGLE_CLIENT_ID_FILE", env.GOOGLE_CLIENT_ID_FILE);
    const clientSecret = await readSecret(
      "GOOGLE_CLIENT_SECRET_FILE",
      env.GOOGLE_CLIENT_SECRET_FILE,
    );
    if (!/^[a-zA-Z0-9.-]+\.apps\.googleusercontent\.com$/.test(clientId))
      throw new Error("GOOGLE_CLIENT_ID_FILE must contain a Google web client ID");
    google = { clientId, clientSecret };
  }
  let github: RuntimeConfig["github"];
  if (env.GITHUB_CLIENT_ID_FILE || env.GITHUB_CLIENT_SECRET_FILE) {
    const clientId = await readSecret("GITHUB_CLIENT_ID_FILE", env.GITHUB_CLIENT_ID_FILE);
    const clientSecret = await readSecret(
      "GITHUB_CLIENT_SECRET_FILE",
      env.GITHUB_CLIENT_SECRET_FILE,
    );
    if (!/^[A-Za-z0-9_.-]{1,200}$/.test(clientId)) throw new Error("Invalid GitHub client ID");
    github = { clientId, clientSecret };
  }
  return {
    environment,
    origin: origin.origin,
    authSecret,
    google,
    github,
    databaseUrl: databaseUrl(
      await readSecret("DATABASE_URL_FILE", env.DATABASE_URL_FILE),
      "brag_runtime",
    ),
  };
}

let config: Promise<RuntimeConfig> | undefined;
export function runtimeConfig() {
  return (config ??= readRuntimeConfig());
}
