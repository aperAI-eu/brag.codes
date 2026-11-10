export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { runtimeConfig } = await import("./lib/config/runtime");
    await runtimeConfig();
    const { startPitchWorker } = await import("./lib/projects/worker");
    await startPitchWorker();
  }
}
