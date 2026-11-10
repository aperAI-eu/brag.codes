import "server-only";
import { database } from "../database/client.ts";
import { runtimeConfig } from "../config/runtime.ts";
import { createAuth } from "./config.ts";

let instance: Promise<ReturnType<typeof createAuth>> | undefined;
export function authentication() {
  return (instance ??= Promise.all([database(), runtimeConfig()]).then(([db, config]) =>
    createAuth(db, config),
  ));
}
