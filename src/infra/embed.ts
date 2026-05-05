import 'dotenv/config';
import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initSchema, pool } from './db.js';
import { MODELS } from '../models.js';

/*
 * Reads every Markdown file from the corpus/ directory and inserts it into the
 * documents table as an embedding vector. Skips files whose content hash has not
 * changed to avoid unnecessary OpenAI API calls. Classifies each file by its
 * filename prefix: quote- becomes past_quote, sop- becomes sop, customer- becomes
 * customer_profile. Run this once after setup and again whenever corpus files change.
 */

const openai = new OpenAI({ maxRetries: 3 });

async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: MODELS.embedding,
    input: text
  });

  const vector = res.data[0]?.embedding;
  if (!vector) throw new Error("No embedding returned from OpenAI");
  return vector;
}

function classifyDocType(filename: string): string {
  if (filename.startsWith('quote-')) return 'past_quote';
  if (filename.startsWith('sop-')) return 'sop';
  if (filename.startsWith('customer-')) return 'customer_profile';
  return 'other';
}

async function main() {
  await initSchema();

  const corpusDir = './corpus';
  const files = await readdir(corpusDir);
  const mdFiles = files.filter(f => f.endsWith('.md'));

  console.log(`Checking ${mdFiles.length} docs for changes...`);

  for (const file of mdFiles) {
    const content = await readFile(join(corpusDir, file), 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    // Skip files whose content hasn't changed — avoid unnecessary embed API calls
    const { rowCount } = await pool.query(
      `SELECT 1 FROM documents WHERE metadata->>'source' = $1 AND content_hash = $2`,
      [file, hash]
    );
    if (rowCount && rowCount > 0) {
      console.log(`  ${file} -> unchanged (skipped)`);
      continue;
    }

    const title = (content.split('\n')[0] ?? '').replace(/^#\s*/, '');
    const docType = classifyDocType(file);
    const embedding = await embed(content);
    const embeddingStr = `[${embedding.join(',')}]`;

    // Remove stale version of this file before inserting the updated one
    await pool.query(`DELETE FROM documents WHERE metadata->>'source' = $1`, [file]);

    await pool.query(
      `INSERT INTO documents (doc_type, title, content, embedding, metadata, content_hash)
       VALUES ($1, $2, $3, $4::vector, $5, $6)`,
      [docType, title, content, embeddingStr, { source: file }, hash]
    );

    console.log(`  ${file} -> ${docType} (embedded)`);
  }

  console.log('Done.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
