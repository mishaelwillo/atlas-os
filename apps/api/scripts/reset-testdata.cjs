// Clean acceptance test data for the atlas space (leaves audit_log — append-only history).
const pg = require('pg');
(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  await c.connect();
  const space = (await c.query("select space_id from spaces where slug='atlas'")).rows[0].space_id;
  const del = async (sql) => (await c.query(sql, [space])).rowCount;
  const cards = await del('delete from memory_cards where space_id=$1');
  const queue = await del('delete from ingest_queue where space_id=$1');
  const appr = await del('delete from approvals where space_id=$1');
  console.log(`cleaned: memory_cards=${cards}, ingest_queue=${queue}, approvals=${appr} (audit_log preserved)`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
