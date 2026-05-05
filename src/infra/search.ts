import "dotenv/config";
import OpenAI from "openai";
import { pool } from "./db.js";
import { MODELS } from "../models.js";

/*
 * Development utility for inspecting the vector index. Runs a similarity search
 * against the documents table and prints results to stdout. Not used by the
 * production pipeline. Run with: npm run search
 */

const openai = new OpenAI({ maxRetries: 3 });

async function search(query: string, k = 3) {
  const emb = await openai.embeddings.create({
    model: MODELS.embedding,
    input: query
  });

  const vector = emb.data[0]?.embedding;
  if (!vector) throw new Error("No embedding returned from OpenAI");
  const embStr = `[${vector.join(",")}]`;

  const r = await pool.query(
    `SELECT title, doc_type, content,
            1 - (embedding <=> $1::vector) AS similarity
     FROM documents
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [embStr, k]
  );

  console.log(`\nQuery: "${query}"\n`);
  for (const row of r.rows) {
    console.log(`  [${(row.similarity as number).toFixed(3)}] ${row.title as string} (${row.doc_type as string})`);
  }
}

await search("Shanghai to Hamburg sea freight pricing");
await search("urgent air shipment for Wagner");
await search("battery shipment requirements");
await pool.end();
