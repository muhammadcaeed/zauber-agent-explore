import { initSchema, pool } from './db.js';

await initSchema();

const r  = await pool.query(`SELECT version()`);
console.log("Connected: ", r.rows[0].version);

await pool.end();