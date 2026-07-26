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
