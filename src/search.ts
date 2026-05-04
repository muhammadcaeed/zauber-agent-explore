import "dotenv/config";
import OpenAI from "openai";
import { pool } from "./db.js";

const openai = new OpenAI();

async function search(query: string, k = 3) {
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query
  });
  const embStr = `[${emb.data[0].embedding.join(",")}]`;

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
    console.log(`  [${row.similarity.toFixed(3)}] ${row.title} (${row.doc_type})`);
  }
}

await search("Shanghai to Hamburg sea freight pricing");
await search("urgent air shipment for Wagner");
await search("battery shipment requirements");
await pool.end();