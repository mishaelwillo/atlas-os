/**
 * Scheduled live-site verification (docs/specs/p2/website-factory.md).
 *
 * `factory.verify_live` only helps if it runs without anyone remembering to run
 * it, so the worker calls it on a timer.
 *
 * It deliberately does NOT go through the `schedules` table. That path executes
 * via `runs.execute`, which for a non-approval capability sends a prompt to the
 * model router and records the model's text as the run's output — it never
 * invokes the capability's handler. Scheduling a deterministic check that way
 * would record a `succeeded` run for a check that never happened, which is
 * worse than not scheduling it at all. That mismatch is a defect in
 * `runs.execute` in its own right; this does not paper over it, it avoids it.
 *
 * The sweep runs per space, because a deployment belongs to one. Spaces come
 * from the live deployments themselves rather than from the space list: a
 * space with nothing published has nothing to verify, and sweeping it would be
 * a query that always returns zero.
 */
import { executeCapability, type PipelineDeps } from './pipeline.js';
import type { AuthContext } from './auth.js';

/** How often the sweep runs when nothing overrides it. */
export const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Below this the sweep would hammer published sites for no added signal. */
export const MIN_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Read the interval from the environment.
 *
 * An unreadable or too-small value falls back to the default rather than
 * failing the worker: a misconfigured interval should not stop the checks, and
 * a one-second sweep would be a self-inflicted load test on customer sites.
 */
export function sweepIntervalMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SWEEP_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return DEFAULT_SWEEP_INTERVAL_MS;
  return Math.max(parsed, MIN_SWEEP_INTERVAL_MS);
}

function systemAuth(spaceId: string): AuthContext {
  return { kind: 'system', actor: 'scheduler:verify_live', spaceId, scopes: ['*'] };
}

export interface SweepTickResult {
  spaces: number;
  checked: number;
  drifted: number;
  failures: number;
}

/**
 * Run one sweep across every space that has something live.
 *
 * A failure in one space does not stop the others: an unreachable tenant is
 * exactly when the remaining ones most need checking.
 */
export async function runLiveSweepTick(deps: PipelineDeps): Promise<SweepTickResult> {
  const meta = deps.capabilities['factory.verify_live'];
  if (!meta) return { spaces: 0, checked: 0, drifted: 0, failures: 0 };

  const spaces = await deps.db.query(
    `select distinct space_id from site_deployments
      where status = 'live' and environment = 'production'`,
  );

  const result: SweepTickResult = { spaces: 0, checked: 0, drifted: 0, failures: 0 };

  for (const row of spaces.rows) {
    const spaceId = String(row.space_id);
    result.spaces += 1;
    try {
      const outcome = await executeCapability(meta, systemAuth(spaceId), {}, deps);
      if (outcome.statusCode >= 400) {
        result.failures += 1;
        deps.log.error({ spaceId, body: outcome.body }, 'live-site sweep failed');
        continue;
      }
      const body = outcome.body as { checked?: number; healthy?: boolean; mismatched?: unknown[]; unreadable?: unknown[] };
      result.checked += Number(body.checked ?? 0);
      if (body.healthy === false) {
        const drifted = (body.mismatched?.length ?? 0) + (body.unreadable?.length ?? 0);
        result.drifted += drifted;
        // Loud on purpose: a live site not serving its approved build is the
        // condition this whole mechanism exists to surface.
        deps.log.error(
          { spaceId, checked: body.checked, drifted, mismatched: body.mismatched, unreadable: body.unreadable },
          'live sites are not serving their approved builds',
        );
      }
    } catch (err) {
      result.failures += 1;
      deps.log.error(
        { spaceId, err: err instanceof Error ? err.message : String(err) },
        'live-site sweep threw',
      );
    }
  }

  return result;
}
