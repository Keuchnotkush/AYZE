/** Starts the loan servicing loop once per Node server process (not in the edge runtime, not at build). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startServicing } = await import("./server/servicing");
  startServicing();
}
