/**
 * P1 acceptance flow over HTTP (brief §Acceptance). Usage:
 *   node --env-file=.env scripts/flow.cjs <API_TOKEN> [space_id]
 * Mints an operator JWT from SUPABASE_JWT_SECRET (local test secret) to drive
 * the operator-only approve step. Prints PASS/FAIL per step.
 */
const crypto = require('node:crypto');

const BASE = process.env.FLOW_BASE || 'http://localhost:3000';
const TOKEN = process.argv[2];
const SPACE = process.argv[3];
if (!TOKEN || !SPACE) {
  console.error('usage: flow.cjs <api_token> <space_id>');
  process.exit(1);
}

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function operatorJwt() {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ email: process.env.OPERATOR_EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
const OP = operatorJwt();

async function call(method, path, { token, jwt, space, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  if (space) headers['x-atlas-space'] = space;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} — ${detail}`); fail++; }
}

(async () => {
  console.log('1) memory.ingest with scoped token → cards land');
  const ingest = await call('POST', '/v1/memory/ingest', {
    token: TOKEN,
    body: { cards: [
      { title: 'AT&T unlock eligibility', body: 'Device paid off + 60 days active. Source outline #2.', source: 'run:acceptance', sourceType: 'own-output', tags: ['att','unlock'], relevanceScore: 80 },
      { title: 'Andtron brand voice', body: 'Confident, plain-spoken, no jargon.', source: 'drive:/brand.md', sourceType: 'primary-doc' },
    ] },
  });
  check('ingest 200', ingest.status === 200, JSON.stringify(ingest));
  check('admitted>=1', ingest.json && ingest.json.admitted >= 1, JSON.stringify(ingest.json));

  console.log('   re-ingest identical cards → deduped (admitted 0, skipped 2)');
  const reingest = await call('POST', '/v1/memory/ingest', {
    token: TOKEN,
    body: { cards: [
      { title: 'AT&T unlock eligibility', body: 'Device paid off + 60 days active. Source outline #2.', source: 'run:acceptance' },
      { title: 'Andtron brand voice', body: 'Confident, plain-spoken, no jargon.', source: 'drive:/brand.md' },
    ] },
  });
  check('re-ingest dedupes (admitted 0)', reingest.json && reingest.json.admitted === 0, JSON.stringify(reingest.json));

  console.log('2) scope enforcement: token calling operator-only approvals.decide → 403');
  const scopeReject = await call('POST', '/v1/approvals/decide', { token: TOKEN, space: SPACE, body: { approvalId: '00000000-0000-0000-0000-000000000000', decision: 'approved' } });
  check('403 for token on decide', scopeReject.status === 403, JSON.stringify(scopeReject));

  console.log('3) outreach.send → approval-gated (approvalId, status:review), NOT sent');
  const outreach = await call('POST', '/v1/outreach/send', {
    jwt: OP, space: SPACE,
    body: { leadId: 'lead-accept-1', channel: 'email', body: 'Hi — noticed your shop has no website. We build one free to demo.' },
  });
  check('outreach 200', outreach.status === 200, JSON.stringify(outreach));
  check('returns approvalId+review', outreach.json && outreach.json.approvalId && outreach.json.status === 'review', JSON.stringify(outreach.json));
  const approvalId = outreach.json && outreach.json.approvalId;

  console.log('4) approvals.list (operator) shows the pending approval');
  const list = await call('GET', '/v1/approvals/list', { jwt: OP, space: SPACE });
  const found = list.json && Array.isArray(list.json.approvals) && list.json.approvals.some((a) => a.approvalId === approvalId);
  check('pending approval listed', found, JSON.stringify(list.json));

  console.log('5) approvals.decide approve (operator) → log-only dispatcher fires');
  const decide = await call('POST', '/v1/approvals/decide', { jwt: OP, space: SPACE, body: { approvalId, decision: 'approved', notes: 'acceptance run' } });
  check('decide 200', decide.status === 200, JSON.stringify(decide));
  check('dispatched stub (no real send)', decide.json && decide.json.dispatched && decide.json.dispatched.stub === true, JSON.stringify(decide.json));

  console.log('6) status.mission_control (operator) returns live cards');
  const status = await call('GET', '/v1/status/mission_control', { jwt: OP });
  const kinds = status.json && status.json.cards ? status.json.cards.map((c) => c.kind) : [];
  check('has all 5 card kinds', ['approvals','runs','model_chain','cache','schedules'].every((k) => kinds.includes(k)), kinds.join(','));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FLOW ERROR:', e.message); process.exit(1); });
