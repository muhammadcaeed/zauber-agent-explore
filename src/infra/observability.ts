import { Langfuse } from "langfuse";

/*
 * Exports the shared Langfuse client. Every workflow step that emits traces,
 * spans, or generations imports langfuse from here. Centralizing the client
 * means all instrumentation flows through one authenticated connection. The
 * client throws at startup if LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY are
 * missing rather than silently dropping traces.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const langfuse = new Langfuse({
  publicKey: requireEnv("LANGFUSE_PUBLIC_KEY"),
  secretKey: requireEnv("LANGFUSE_SECRET_KEY"),
  baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
});
