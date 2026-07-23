/** Router tests (brief §6): fallback on simulated 429, chain exhaustion, cost. */
import { describe, expect, it } from 'vitest';
import {
  RetryableModelError,
  createRouter,
  type ChatMessage,
  type CompletionResult,
  type ModelProvider,
  type ProviderCallOptions,
} from './index.js';

const msg: ChatMessage[] = [{ role: 'user', content: 'hi' }];

function scriptedProvider(script: Record<string, () => CompletionResult>): ModelProvider & { callLog: string[] } {
  const callLog: string[] = [];
  return {
    name: 'scripted',
    callLog,
    async complete(model: string, _m: ChatMessage[], _o: ProviderCallOptions): Promise<CompletionResult> {
      callLog.push(model);
      const fn = script[model];
      if (!fn) throw new Error(`no script for ${model}`);
      return fn();
    },
  };
}

describe('createRouter', () => {
  it('falls back to the next model on 429', async () => {
    const provider = scriptedProvider({
      'model/a': () => {
        throw new RetryableModelError('model/a', 'rate-limit', 'HTTP 429');
      },
      'model/b': () => ({ text: 'ok', model: 'model/b', tokensIn: 5, tokensOut: 7, costUsd: 0 }),
    });
    const router = createRouter(
      { chains: { think: [], do: ['model/a', 'model/b'], quick: [] }, timeoutMs: 1000, backoffMs: 1 },
      provider,
    );
    const res = await router.complete('do', msg);
    expect(res.model).toBe('model/b');
    expect(provider.callLog).toEqual(['model/a', 'model/b']);
  });

  it('throws after the whole chain fails, naming each failure', async () => {
    const provider = scriptedProvider({
      'model/a': () => {
        throw new RetryableModelError('model/a', 'rate-limit', '429');
      },
      'model/b': () => {
        throw new RetryableModelError('model/b', 'timeout', 'timeout');
      },
    });
    const router = createRouter(
      { chains: { think: [], do: ['model/a', 'model/b'], quick: [] }, timeoutMs: 1000, backoffMs: 1 },
      provider,
    );
    await expect(router.complete('do', msg)).rejects.toThrow(/model\/a: rate-limit.*model\/b: timeout/);
  });

  it('does not retry non-retryable errors', async () => {
    const provider = scriptedProvider({
      'model/a': () => {
        throw new Error('HTTP 400 bad request');
      },
      'model/b': () => ({ text: 'never', model: 'model/b', tokensIn: 0, tokensOut: 0, costUsd: 0 }),
    });
    const router = createRouter(
      { chains: { think: [], do: ['model/a', 'model/b'], quick: [] }, timeoutMs: 1000, backoffMs: 1 },
      provider,
    );
    await expect(router.complete('do', msg)).rejects.toThrow('HTTP 400');
    expect(provider.callLog).toEqual(['model/a']);
  });

  it('applies the cost table per million tokens', async () => {
    const provider = scriptedProvider({
      'model/paid': () => ({ text: 'ok', model: 'model/paid', tokensIn: 1_000_000, tokensOut: 500_000, costUsd: 0 }),
    });
    const router = createRouter(
      {
        chains: { think: ['model/paid'], do: [], quick: [] },
        timeoutMs: 1000,
        costPerMTokens: { 'model/paid': { in: 3, out: 15 } },
      },
      provider,
    );
    const res = await router.complete('think', msg);
    expect(res.costUsd).toBeCloseTo(3 + 7.5);
  });

  it('rejects an empty chain', async () => {
    const provider = scriptedProvider({});
    const router = createRouter({ chains: { think: [], do: [], quick: [] }, timeoutMs: 1000 }, provider);
    await expect(router.complete('quick', msg)).rejects.toThrow(/no model chain/);
  });
});
