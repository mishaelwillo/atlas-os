// Probe Supabase pooler regions across both aws-0 and aws-1 clusters.
const pg = require('pg');

const REF = 'yyyspvralawnvhtmuyvg';
const urlNow = process.env.DATABASE_URL || '';
const encPw = (urlNow.match(/postgres\.[^:]+:([^@]+)@/) || [, ''])[1];

const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
];
const HOSTS = ['aws-0', 'aws-1'].flatMap((p) => REGIONS.map((r) => `${p}-${r}.pooler.supabase.com`));

async function tryHost(host) {
  const cs = `postgresql://postgres.${REF}:${encPw}@${host}:5432/postgres?sslmode=no-verify`;
  const client = new pg.Client({ connectionString: cs, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('select 1');
    await client.end();
    return 'CONNECTED';
  } catch (e) {
    await client.end().catch(() => {});
    return e.message;
  }
}

(async () => {
  for (const host of HOSTS) {
    const msg = await tryHost(host);
    if (!/not found/i.test(msg)) {
      console.log(`${host}  =>  ${msg}`);
    }
    if (msg === 'CONNECTED' || /password/i.test(msg)) {
      console.log(`>>> FOUND HOST: ${host}`);
      process.exit(0);
    }
  }
  console.log('no pooler host recognized the tenant (checked 34 hosts)');
})();
