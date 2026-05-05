# Zauber Rate-Quote System

This system handles inbound freight rate-quote emails end to end. A customer email
comes in, the system extracts the shipment details, fetches live carrier rates,
and produces a ready-to-send reply. If the email is missing required information,
the system runs a clarification loop to collect it before drafting.

The pipeline routes every completed draft through a confidence check. High-confidence
drafts are marked for auto-send. Low-confidence ones go to human review.

---

## How it works

```
email
  │
  ▼
[extract]       Haiku extracts origin, destination, weight, mode, customer, urgency
  │             Forced tool use ensures structured output. Zod validates before use.
  │
  ▼
[clarify]       If required fields are missing, a multi-turn agent asks the customer
  │             one question per turn and re-extracts after each reply. Up to 3 turns.
  │             Resolves or returns the last unanswered question.
  ▼
[retrieve]      Hybrid search over the corpus: pgvector cosine + Postgres BM25,
  │             fused with Reciprocal Rank Fusion. Also runs a targeted lookup for
  │             the customer profile if a customer name was extracted.
  ▼
[rates]         Mock carrier API returns quotes from Maersk, Hapag-Lloyd, and MSC.
  │
  ▼
[draft]         Sonnet receives the email, rates, and retrieved context.
  │             Returns a draft reply with a self-reported confidence score.
  ▼
[confidence]    Blends model confidence with 6 structural heuristics (rate count,
  │             price validity, carrier mentions in draft, retrieval relevance).
  ▼
auto-send       confidence >= 0.75
  OR
human review    confidence < 0.75
```

---

## AI Components

### Extract

**Model:** Claude Haiku — fast and cheap for a deterministic extraction task.

**Prompt strategy:** System prompt and tool schema are both marked `cache_control: ephemeral`
so they hit the prompt cache on repeated calls. Tool use is forced to `record_shipment_details`,
which means the model must return a structured schema. There is no free-text output path.

**Output contract:** `ExtractedDetails` — origin, destination, weightKg, mode, customer,
urgency, and a `missingFields` array computed from which required fields came back null.

**Failure mode:** If the model returns no tool use block, or if Zod rejects the output,
the function throws. The workflow catches this at the top level and records a `failed` trace.

---

### Clarify

**Model:** Claude Haiku — same reasoning as extract. Short turns, low cost.

**Prompt strategy:** Forced tool use on `ask_customer`. The tool schema accepts a single
`question` field, which prevents the model from asking multiple questions at once.

**Behavior:** Each turn appends the customer reply to the conversation, then calls
`extractDetails` again on the full conversation text. This means every previously answered
field stays in scope. The loop stops when `missingFields` is empty or the turn limit is hit.

**Output contract:** `ClarifyResult` — the latest extraction, turn count, and
`lastQuestion`. A null `lastQuestion` means all required fields are resolved.

---

### Draft

**Model:** Claude Sonnet — higher quality for customer-facing output.

**Prompt strategy:** System prompt and tool schema are cached. The user message is not
cached because it contains per-request content (email, rates, context). Tool use is forced
to `compose_reply`, which returns the draft text, a confidence score from 0 to 1, and a
reasoning note.

**Output contract:** `DraftResult` — draftReply, selfReportedConfidence, reasoning.

**Failure mode:** Same as extract — no tool use or Zod rejection throws immediately.

---

### Confidence

Not a model call. Blends two signals:

1. **Self-reported confidence** from the draft step (0 to 1)
2. **Structural heuristics** — six independent checks:
   - Did the rates tool return exactly 3 carriers?
   - Are all `validUntil` dates parseable ISO strings?
   - Are all `validUntil` dates in the future?
   - Are all carrier prices positive?
   - Does the draft mention all three carrier names?
   - Did retrieval return at least one document with similarity above 0.4?

The heuristic score is the fraction of checks that pass (0 to 1). Final confidence is
`(selfReported + heuristicScore) / 2`. Drafts at or above `AUTO_SEND_THRESHOLD = 0.75`
are marked auto-send eligible.

---

## Tech Stack

| Tool | Version | Purpose |
|------|---------|---------|
| TypeScript | 5+ | Type safety across the whole pipeline |
| tsx | 4+ | Run TypeScript directly without a build step |
| Anthropic SDK | 0.92+ | Claude API for extract, clarify, and draft |
| OpenAI SDK | 6+ | Embeddings only (text-embedding-3-small) |
| Postgres + pgvector | Docker | Document store and vector index |
| Langfuse | 3+ | Tracing and observability per run |
| Zod | 4+ | Runtime validation of all LLM outputs |
| Vitest | 4+ | Unit tests |

---

## Observability

Every run produces a Langfuse trace named `rate_inquiry_workflow`. Inside it:

- `extract` generation — model, token usage, cache hits, extracted fields
- `clarify_turn_N` generation — one entry per clarification turn
- `retrieve` span — query string, whether a customer profile was fetched, top hits with scores
- `rates_tool` span — carrier count
- `draft` generation — model, token usage, self-reported confidence
- `confidence` span — per-heuristic breakdown, final score
- `final_confidence` score — queryable in Langfuse for filtering runs by outcome

If the email contains likely prompt injection markers, a `security_check` span is added.
The injection is logged but not blocked. A production system would add a classifier.

---

## Setup

**Prerequisites:** Node.js 20+, Docker, an Anthropic API key, an OpenAI API key.
Langfuse keys are optional but recommended.

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres with pgvector
docker compose up -d

# 3. Copy the env template and fill in your API keys
cp .env.example .env

# 4. Create the database schema
npm run init

# 5. Embed the corpus documents
npm run embed
```

`npm run embed` checks content hashes and skips files that have not changed.
Re-run it whenever you update files in `corpus/`.

---

## Running the workflow

```bash
npm run agent <n>
```

| n | Scenario |
|---|----------|
| 0 | Clean sea freight, all fields present |
| 1 | Missing weight, agent asks one question, customer replies |
| 2 | Dangerous goods (lithium batteries), repeat customer |
| 3 | Mode unclear, agent asks, customer replies with sea freight |
| 4 | Prompt injection attempt followed by a real request |
| 5 | Missing weight in air freight, resolved in one turn |
| 6 | Missing origin and mode, resolved in two turns |

---

## Eval

```bash
npm run eval
```

Runs 10 labelled cases from `evals/dataset.json`. Checks `status` and `missingFields`
against expected values. Target is 8 out of 10 passing. A change that drops this score
is a regression even if unit tests still pass.

---

## Codebase map

```
src/
  steps/
    extract.ts       Haiku extraction — email text to structured fields
    clarify.ts       Multi-turn clarification agent
    retrieve.ts      Hybrid pgvector + BM25 retrieval with RRF fusion
    draft.ts         Sonnet draft with self-reported confidence
  infra/
    db.ts            Postgres connection pool and schema init
    observability.ts Langfuse client shared by all steps
    embed.ts         Corpus ingestion script (npm run embed)
    init.ts          Schema creation script (npm run init)
    search.ts        Development utility for inspecting the vector index
  tools/
    carrierRates.ts  Mock carrier rate API with tool schema for Claude
  workflow.ts        Pipeline orchestration and confidence blend
  run.ts             CLI entry point with scenario runner
  types.ts           Shared TypeScript types
  models.ts          Model IDs, AUTO_SEND_THRESHOLD, and tunables

evals/
  dataset.json       10 labelled test cases
  run.ts             Eval harness

tests/
  extract.test.ts         Unit tests for field extraction and missing-field logic
  clarify.test.ts         Unit tests for conversation text builder
  tools/
    carrierRates.test.ts  Unit tests for rate calculation and carrier output shape

corpus/             Markdown documents embedded into pgvector at setup time
```

---

## Known limitations and future work

- **Chunking:** corpus files are embedded whole. At scale, use semantic chunking (~500 tokens, sentence boundary) with parent-document retrieval.
- **Hybrid search:** the current BM25 + vector fusion improves on pure vector search, but a cross-encoder reranker on the top 20 candidates would improve precision further.
- **Multi-language:** no language detection. Non-English emails will degrade extraction accuracy.
- **Prompt injection:** injection markers are flagged in Langfuse but not blocked. A production system needs a classifier guardrail before the extraction step.
- **Carrier API:** rates are mocked. A real integration would authenticate against each carrier TMS, handle their schemas, and manage SLA timeouts.
- **Confidence calibration:** `AUTO_SEND_THRESHOLD = 0.75` is a starting point. Calibrate against a labelled eval set targeting 95% precision on auto-sends before using in production.
- **Cost tracking:** token usage flows to Langfuse per generation. Aggregate cost per run is visible in the Langfuse dashboard. The CLI also prints a per-run cost estimate.
