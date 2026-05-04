import 'dotenv/config';
import OpenAI from 'openai';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initSchema, pool} from './db.js';

const openai = new OpenAI();

async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });

  return res.data[0].embedding;
}

function classifyDocType(filename: string): string {
  if (filename.startsWith('quote-')) return 'past_quote';
  if (filename.startsWith('sop-')) return 'sop';
  if (filename.startsWith('customer-')) return 'customer_profile';

  return 'other';
}

async function main() {
  await initSchema();

  await pool.query(`TRUNCATE documents RESTART IDENTITY`);

  const corpusDir = './corpus';
  const files = await readdir(corpusDir);
  const mdFiles = files.filter(f => f.endsWith('.md'));

  console.log(`Embedding ${mdFiles.length} docs...`);


  for (const file of files) {
    const content = await readFile(join(corpusDir, file), 'utf-8');
    const title = content.split('\n')[0].replace(/^#\s*/, '');
    const docType = classifyDocType(file);

    const embedding = await embed(content);
    const embeddingStr = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO documents (doc_type, title, content, embedding, metadata)
      VALUES ($1, $2, $3, $4::vector, $5)`,
      [docType, title, content, embeddingStr, { source: file }]
    );

    console.log(`  ${file} -> ${docType}`);
  }

  console.log('Done.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});