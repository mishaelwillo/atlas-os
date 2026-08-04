import { z } from 'zod';
import { containsSecret } from './secrets.js';

export const WorkStatusSchema = z.enum([
  'queued',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'done',
]);

export const DriftSeveritySchema = z.enum(['info', 'warning', 'blocking']);

export const CapabilityStageSchema = z.enum([
  'observed',
  'catalogued',
  'candidate',
  'experiment',
  'validated',
  'production',
  'core',
  'deferred',
  'integration-only',
  'rejected',
  'superseded',
  'retired',
]);

const ALLOWED_SECRET_LIKE_KEYS = new Set([
  'required_variable_names',
  'expected_secret_names',
  'project_ref',
]);
const SECRET_KEY_PATTERN = /token|password|secret|private[_-]?key/i;

export function assertNoSecrets(value: unknown, path = 'root'): void {
  if (typeof value === 'string') {
    if (containsSecret(value)) {
      throw new Error(`${path}: prohibited secret value`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecrets(entry, `${path}[${index}]`));
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (containsSecret(key)) {
      throw new Error(`${path}: prohibited secret key`);
    }
    if (SECRET_KEY_PATTERN.test(key) && !ALLOWED_SECRET_LIKE_KEYS.has(key)) {
      throw new Error(`${entryPath}: prohibited secret key`);
    }
    assertNoSecrets(entry, entryPath);
  }
}

const PublicEndpointSchema = z
  .object({
    public_url: z.string().url(),
    health_path: z.string().startsWith('/'),
  })
  .strict();

/**
 * Where published customer sites are actually served from.
 *
 * Atlas itself runs on Railway; generated business sites do not, and that
 * distinction is the whole reason a hosting adapter exists. Until this section
 * existed the provider, project, account and public address were prose in
 * CURRENT_STATE.md — which meant hosting configuration had no schema, the
 * collector could not observe it, and drift in it had no detector at all. The
 * hourly `factory.verify_live` sweep caught the symptom afterwards; nothing
 * caught the cause.
 *
 * Required, not optional. An optional section is one a future environment can
 * silently omit, which is exactly how the gap appeared the first time.
 *
 * NO CREDENTIAL LIVES HERE. `required_variable_names` holds variable NAMES,
 * and the collector only ever reports whether each is set.
 */
const HostingSchema = z
  .object({
    provider: z.literal('cloudflare-pages'),
    /** Cloudflare account identifier: 32 lowercase hex characters. */
    account_id: z.string().regex(/^[0-9a-f]{32}$/),
    pages_project: z.string().min(1),
    /**
     * The provider's own address for the project — the origin the public
     * address fronts. Kept separately because the two serving different bytes
     * is a real, previously-observed failure: a zone setting once rewrote the
     * public response while the origin served the approved build exactly.
     */
    provider_url: z.string().url(),
    /** Where a published site's recorded address actually points. */
    public_base_url: z.string().url(),
    zone: z.string().min(1),
    /** Path-based (`/<slug>`) or per-site subdomain; `publicUrl` implements it. */
    layout: z.enum(['path', 'subdomain']),
    required_variable_names: z.array(z.string().min(1)),
  })
  .strict();

const EnvironmentSchema = z
  .object({
    github: z
      .object({
        repository: z.string().min(1),
        branch: z.string().min(1),
      })
      .strict(),
    supabase: z
      .object({
        project_ref: z.string().min(1),
        expected_migration: z.string().min(1),
        required_tables: z.array(z.string().min(1)),
      })
      .strict(),
    railway: z
      .object({
        api: PublicEndpointSchema,
        os: PublicEndpointSchema,
      })
      .strict(),
    hosting: HostingSchema,
    required_variable_names: z.array(z.string().min(1)),
    expected_secret_names: z.array(z.string().min(1)).optional(),
  })
  .strict();

const EnvironmentFileShapeSchema = z
  .object({
    schema_version: z.literal(1),
    environments: z.record(z.string().min(1), EnvironmentSchema),
  })
  .strict();

export const EnvironmentFileSchema = z.preprocess((value) => {
  assertNoSecrets(value);
  return value;
}, EnvironmentFileShapeSchema);

export const WorkItemSchema = z
  .object({
    id: z.string().min(1),
    phase: z.string().min(1),
    title: z.string().min(1),
    status: WorkStatusSchema,
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    dependencies: z.array(z.string().min(1)),
    specification: z.string().min(1),
    acceptance_checks: z.array(z.string().min(1)),
    next_action: z.string().min(1),
  })
  .strict();

export const WorkQueueSchema = z
  .object({
    schema_version: z.literal(1),
    items: z.array(WorkItemSchema),
  })
  .strict();

export type EnvironmentFile = z.infer<typeof EnvironmentFileSchema>;
export type WorkQueue = z.infer<typeof WorkQueueSchema>;
export type WorkItem = z.infer<typeof WorkItemSchema>;
export type DriftSeverity = z.infer<typeof DriftSeveritySchema>;

export interface Finding {
  severity: DriftSeverity;
  code: string;
  path: string;
  message: string;
}
