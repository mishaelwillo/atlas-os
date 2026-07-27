/** Central env access — nothing else reads process.env directly. */
import { parseDailyCap } from './policy.js';
export interface Env {
  databaseUrl: string;
  /** Sole operator email pinned in is_operator() (SECURITY.md). */
  operatorEmail: string;
  /** Maximum outreach touches per space per day; 0 or less disables the cap. */
  outreachDailyCap: number;
  /** Supabase project URL — used to fetch the JWKS for ES256/RS256 operator
   *  tokens (new Supabase "JWT Signing Keys"). */
  supabaseUrl: string;
  /** HS256 secret for legacy symmetric Supabase JWTs (and the local test
   *  harness). Empty/legacy projects only; asymmetric keys use the JWKS. */
  supabaseJwtSecret: string;
  /** OpenRouter-compatible endpoint for the model router. */
  modelBaseUrl: string;
  modelApiKey: string;
  /** Ordered model chains per task class, comma-separated. */
  chainThink: string[];
  chainDo: string[];
  chainQuick: string[];
  modelTimeoutMs: number;
}

export interface BuildEnv {
  gitSha: string;
  buildTime: string;
  schemaVersion: string;
}

function list(v: string | undefined, fallback: string[]): string[] {
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizedValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return undefined;
  return normalized;
}

function gitSha(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = normalizedValue(value);
    if (normalized && /^[0-9a-f]{7,64}$/i.test(normalized)) return normalized.toLowerCase();
  }
  return 'unknown';
}

function buildTime(value: string | undefined): string {
  const normalized = normalizedValue(value);
  if (!normalized) return 'unknown';
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i,
  );
  if (!match) return 'unknown';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth =
    month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > daysInMonth) return 'unknown';

  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? 'unknown' : new Date(timestamp).toISOString();
}

function schemaVersion(value: string | undefined): string {
  if (value === undefined) return '0001_init';
  const normalized = normalizedValue(value);
  if (normalized === undefined) return 'unknown';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized) ? normalized : 'unknown';
}

export function loadBuildEnv(source: NodeJS.ProcessEnv = process.env): BuildEnv {
  return {
    gitSha: gitSha(source.ATLAS_GIT_SHA, source.RAILWAY_GIT_COMMIT_SHA),
    buildTime: buildTime(source.ATLAS_BUILD_TIME),
    schemaVersion: schemaVersion(source.ATLAS_SCHEMA_VERSION),
  };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    databaseUrl: source.DATABASE_URL ?? '',
    operatorEmail: source.OPERATOR_EMAIL ?? 'mobiledynamic876@gmail.com',
    outreachDailyCap: parseDailyCap(source.ATLAS_OUTREACH_DAILY_CAP),
    supabaseUrl: (source.SUPABASE_URL ?? '').replace(/\/+$/, ''),
    supabaseJwtSecret: source.SUPABASE_JWT_SECRET ?? '',
    modelBaseUrl: source.ATLAS_MODEL_BASE_URL ?? 'https://openrouter.ai/api',
    modelApiKey: source.ATLAS_MODEL_API_KEY ?? '',
    chainThink: list(source.ATLAS_CHAIN_THINK, ['anthropic/claude-sonnet-4.5']),
    chainDo: list(source.ATLAS_CHAIN_DO, [
      'deepseek/deepseek-chat-v3-0324:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'qwen/qwen-2.5-72b-instruct:free',
    ]),
    chainQuick: list(source.ATLAS_CHAIN_QUICK, [
      'meta-llama/llama-3.2-3b-instruct:free',
      'qwen/qwen-2.5-7b-instruct:free',
    ]),
    modelTimeoutMs: Number(source.ATLAS_MODEL_TIMEOUT_MS ?? 45000),
  };
}
