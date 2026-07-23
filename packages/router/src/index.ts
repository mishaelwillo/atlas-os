/**
 * @atlas/router — TS-native port of the freellm.cjs routing concept (P1 §3):
 *   - ordered model chain per task_class (env/config)
 *   - per-call timeout (AbortController)
 *   - 429 / 5xx / timeout → skip to next model in the chain
 *   - global queue, concurrency 2, jittered backoff between failures
 *     (free tiers throttle in bursts — freellm lesson)
 *   - every call reports tokensIn/tokensOut + costUsd for the run row
 * Providers: OpenRouter-compatible HTTP first; stub interfaces for others.
 */

export type TaskClass = 'think' | 'do' | 'quick';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ProviderCallOptions {
  timeoutMs: number;
  maxTokens?: number;
}

/** A model backend. OpenRouterProvider is the real one; others are stubs. */
export interface ModelProvider {
  readonly name: string;
  complete(model: string, messages: ChatMessage[], opts: ProviderCallOptions): Promise<CompletionResult>;
}

/** Retryable failure → skip to the next model in the chain. */
export class RetryableModelError extends Error {
  constructor(
    public readonly model: string,
    public readonly reason: 'rate-limit' | 'server-error' | 'timeout',
    message: string,
  ) {
    super(message);
  }
}

export interface RouterConfig {
  chains: Record<TaskClass, string[]>;
  timeoutMs: number;
  concurrency?: number;
  /** base backoff ms between chain hops; jitter is added on top */
  backoffMs?: number;
  /** usd per 1M tokens, keyed by model id — free tiers default to 0 */
  costPerMTokens?: Record<string, { in: number; out: number }>;
}

export interface AtlasRouter {
  complete(taskClass: TaskClass, messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<CompletionResult>;
}

// ---------- OpenRouter-compatible provider ----------

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}
interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: OpenRouterUsage;
}

export interface OpenRouterProviderOptions {
  baseUrl: string; // e.g. https://openrouter.ai/api
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class OpenRouterProvider implements ModelProvider {
  readonly name = 'openrouter';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenRouterProviderOptions) {
    this.baseUrl = opts.baseUrl.endsWith('/') ? opts.baseUrl.slice(0, -1) : opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(model: string, messages: ChatMessage[], opts: ProviderCallOptions): Promise<CompletionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: opts.maxTokens }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw new RetryableModelError(model, 'timeout', `timeout after ${opts.timeoutMs}ms`);
      throw new RetryableModelError(model, 'server-error', err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) throw new RetryableModelError(model, 'rate-limit', 'HTTP 429');
    if (res.status >= 500) throw new RetryableModelError(model, 'server-error', `HTTP ${res.status}`);
    if (!res.ok) throw new Error(`model call failed: HTTP ${res.status} (${await res.text().catch(() => '')})`);

    const json = (await res.json()) as OpenRouterResponse;
    const text = json.choices?.[0]?.message?.content ?? '';
    return {
      text,
      model,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
      costUsd: 0, // filled by the router from its cost table
    };
  }
}

// ---------- stub provider interfaces (P1 scope: interfaces only) ----------

/** Anthropic-native adapter — NOT implemented in P1; here so the router API is stable. */
export interface AnthropicProviderStub extends ModelProvider {
  readonly name: 'anthropic';
}
/** Local Ollama adapter — NOT implemented in P1. */
export interface OllamaProviderStub extends ModelProvider {
  readonly name: 'ollama';
}

// ---------- concurrency queue ----------

class TaskQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}

// ---------- router ----------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createRouter(config: RouterConfig, provider: ModelProvider): AtlasRouter {
  const queue = new TaskQueue(config.concurrency ?? 2);
  const backoffBase = config.backoffMs ?? 750;

  function priceOf(model: string, tokensIn: number, tokensOut: number): number {
    const price = config.costPerMTokens?.[model];
    if (!price) return 0;
    return (tokensIn * price.in + tokensOut * price.out) / 1_000_000;
  }

  return {
    async complete(taskClass, messages, opts = {}) {
      const chain = config.chains[taskClass];
      if (!chain || chain.length === 0) throw new Error(`no model chain configured for task class '${taskClass}'`);

      const failures: string[] = [];
      for (let i = 0; i < chain.length; i += 1) {
        const model = chain[i];
        try {
          const result = await queue.run(() =>
            provider.complete(model, messages, { timeoutMs: config.timeoutMs, maxTokens: opts.maxTokens }),
          );
          return { ...result, costUsd: priceOf(model, result.tokensIn, result.tokensOut) };
        } catch (err) {
          if (err instanceof RetryableModelError && i < chain.length - 1) {
            failures.push(`${model}: ${err.reason}`);
            // jittered backoff — free tiers throttle in bursts
            await sleep(backoffBase * (i + 1) + Math.floor(Math.random() * 250));
            continue;
          }
          if (err instanceof RetryableModelError) {
            throw new Error(`all models in '${taskClass}' chain failed: ${[...failures, `${model}: ${err.reason}`].join('; ')}`);
          }
          throw err;
        }
      }
      throw new Error('unreachable');
    },
  };
}
