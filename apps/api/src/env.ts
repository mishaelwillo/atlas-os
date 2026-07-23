/** Central env access — nothing else reads process.env directly. */
export interface Env {
  databaseUrl: string;
  /** Sole operator email pinned in is_operator() (SECURITY.md). */
  operatorEmail: string;
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

function list(v: string | undefined, fallback: string[]): string[] {
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    databaseUrl: source.DATABASE_URL ?? '',
    operatorEmail: source.OPERATOR_EMAIL ?? 'mobiledynamic876@gmail.com',
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
