/**
 * P1 manual acceptance helper (brief §Acceptance). Run from apps/api:
 *   node --env-file=.env scripts/acceptance.cjs check   — connectivity + migration state
 *   node --env-file=.env scripts/acceptance.cjs migrate — apply 0001_init.sql (only if tables missing)
 *   node --env-file=.env scripts/acceptance.cjs seed    — spaces + scoped api token (prints plaintext ONCE)
 *   node --env-file=.env scripts/acceptance.cjs verify  — post-flow: cards/approvals/audit/messages state
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pg = require('pg');

const EXPECTED_TABLES = [
  'spaces', 'api_tokens', 'runs', 'run_logs', 'approvals', 'audit_log', 'schedules',
  'memory_cards', 'memory_nodes', 'memory_edges', 'playbooks', 'answer_cache',
  'ingest_queue', 'sites', 'leads', 'conversations', 'messages', 'bench_results',
];

async function withClient(fn) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function tableState(client) {
  const r = await client.query(
    "select table_name from information_schema.tables where table_schema='public'",
  );
  const present = new Set(r.rows.map((x) => x.table_name));
  return { present: [...present].sort(), missing: EXPECTED_TABLES.filter((t) => !present.has(t)) };
}

const cmd = process.argv[2];

async function main() {
  if (cmd === 'check') {
    await withClient(async (c) => {
      const v = await c.query('select version()');
      console.log('CONNECTED:', v.rows[0].version.split(',')[0]);
      const s = await tableState(c);
      console.log('tables present:', s.present.join(', ') || '(none)');
      console.log(s.missing.length === 0 ? 'MIGRATION: applied (all 18 tables present)' : `MIGRATION: missing ${s.missing.length} tables → ${s.missing.join(', ')}`);
    });
  } else if (cmd === 'migrate') {
    await withClient(async (c) => {
      const s = await tableState(c);
      if (s.missing.length === 0) {
        console.log('migration already applied — refusing to re-run');
        return;
      }
      if (s.present.some((t) => EXPECTED_TABLES.includes(t))) {
        console.log('PARTIAL schema detected — not auto-running. Present:', s.present.join(', '));
        process.exit(2);
      }
      const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0001_init.sql'), 'utf8');
      await c.query(sql);
      const after = await tableState(c);
      console.log(after.missing.length === 0 ? 'MIGRATION APPLIED — all tables present' : `still missing: ${after.missing.join(', ')}`);
    });
  } else if (cmd === 'seed') {
    await withClient(async (c) => {
      await c.query(
        "insert into spaces (slug, name, kind) values ('studio','Studio (system)','system') on conflict (slug) do nothing",
      );
      await c.query(
        "insert into spaces (slug, name, kind) values ('atlas','Atlas OS','app') on conflict (slug) do nothing",
      );
      const space = await c.query("select space_id from spaces where slug='atlas'");
      const spaceId = space.rows[0].space_id;
      const plaintext = 'atlas_live_' + crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
      await c.query(
        `insert into api_tokens (space_id, label, token_hash, scopes)
         values ($1, 'p1-acceptance-agent', $2, '{memory:read,memory:write,runs:write,events:write}')`,
        [spaceId, hash],
      );
      console.log('SPACE atlas:', spaceId);
      console.log('TOKEN (plaintext, shown once — stored only as sha256):');
      console.log(plaintext);
    });
  } else if (cmd === 'verify') {
    await withClient(async (c) => {
      const q = async (label, sql) => {
        const r = await c.query(sql);
        console.log(`— ${label}:`);
        for (const row of r.rows) console.log(' ', JSON.stringify(row));
        if (r.rows.length === 0) console.log('  (none)');
      };
      await q('memory_cards', 'select title, source, source_type, left(content_hash,12) as hash from memory_cards order by created_at desc limit 5');
      await q('ingest_queue', 'select source_path, status from ingest_queue order by created_at desc limit 5');
      await q('approvals', 'select left(approval_id::text,8) as id, kind, status, decided_by from approvals order by created_at desc limit 5');
      await q('messages (should have NO outbound)', "select direction, sender, left(body,40) as body from messages order by created_at desc limit 5");
      await q('audit_log', 'select actor, action, target from audit_log order by created_at desc limit 12');
      await q('runs', 'select capability, status, task_class from runs order by created_at desc limit 5');
    });
  } else {
    console.log('usage: acceptance.cjs check|migrate|seed|verify');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
