import "dotenv/config";
import { readFile } from "node:fs/promises";
import { handleRateInquiry } from "../src/workflow.js";
import { pool } from "../src/db.js";

type EvalCase = {
  id: string;
  email: string;
  followUpReplies?: string[];
  expected: {
    status: "drafted" | "needs_clarification" | "failed";
    missingFields?: string[];
    mode?: string | null;
    clarificationTurns?: number;
  };
};

type EvalResult = {
  id: string;
  pass: boolean;
  failures: string[];
  status: string;
  durationMs: number;
};

async function runCase(ec: EvalCase): Promise<EvalResult> {
  const start = Date.now();
  const failures: string[] = [];

  const result = await handleRateInquiry(ec.email, ec.followUpReplies ?? []);

  if (result.status !== ec.expected.status) {
    failures.push(`status: got "${result.status}", want "${ec.expected.status}"`);
  }

  if (ec.expected.missingFields !== undefined) {
    const traceExtract = result.trace.find((t) => t.step === "extract");
    const actualMissing: string[] = traceExtract?.details
      ? (traceExtract.details["missingFields"] as string[] | undefined) ?? []
      : [];

    for (const field of ec.expected.missingFields) {
      if (!actualMissing.includes(field)) {
        failures.push(`missingFields: expected "${field}" in [${actualMissing.join(", ")}]`);
      }
    }
  }

  if (ec.expected.clarificationTurns !== undefined) {
    if (result.clarificationTurns !== ec.expected.clarificationTurns) {
      failures.push(
        `clarificationTurns: got ${result.clarificationTurns ?? "undefined"}, want ${ec.expected.clarificationTurns}`
      );
    }
  }

  return {
    id: ec.id,
    pass: failures.length === 0,
    failures,
    status: result.status,
    durationMs: Date.now() - start,
  };
}

async function main() {
  const raw = await readFile(new URL("./dataset.json", import.meta.url), "utf-8");
  const dataset = JSON.parse(raw) as EvalCase[];

  console.log(`Running ${dataset.length} eval cases...\n`);

  const results: EvalResult[] = [];

  for (const ec of dataset) {
    process.stdout.write(`  ${ec.id.padEnd(24)} `);
    const r = await runCase(ec);
    results.push(r);
    if (r.pass) {
      console.log(`PASS  (${r.durationMs}ms)`);
    } else {
      console.log(`FAIL  (${r.durationMs}ms)`);
      for (const f of r.failures) console.log(`         ✗ ${f}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);

  await pool.end();

  if (passed < results.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
