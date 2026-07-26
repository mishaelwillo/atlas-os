import { readFile } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { CapabilityStageSchema } from './schemas.js';

const IdentifierSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'must be a stable lowercase identifier');
const CapabilityIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/, 'must be a dot-namespaced capability ID');
const TimecodeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}:\d{2}$/, 'must use HH:MM:SS');
const TimeRangeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}:\d{2}-\d{2}:\d{2}:\d{2}$/, 'must use HH:MM:SS-HH:MM:SS');
const WatchArtifactReferenceSchema = z
  .string()
  .regex(
    /^watch:[A-Za-z0-9_-]{11}:(?:captions@\d{2}:\d{2}:\d{2}-\d{2}:\d{2}:\d{2}|frame_\d{4}@\d{2}:\d{2}:\d{2})$/,
    'must be a portable Watch reference',
  );

function isSafeRepositoryPath(value: string): boolean {
  if (isAbsolute(value) || value.includes('\\')) return false;
  const normalized = posix.normalize(value);
  return (
    normalized === value &&
    !normalized.startsWith('../') &&
    normalized !== '..' &&
    normalized.startsWith('docs/')
  );
}

function timecodeToSeconds(value: string): number {
  const [hours, minutes, seconds] = value.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function rangeBounds(value: string): [number, number] {
  const [start, end = start] = value.split('-');
  return [timecodeToSeconds(start), timecodeToSeconds(end)];
}

const RepositorySpecificationSchema = z
  .string()
  .min(1)
  .refine(isSafeRepositoryPath, 'must be a repository-root-relative docs/ path');

const ResearchSourceSchema = z
  .object({
    id: IdentifierSchema,
    source_url: z.string().url(),
    source_type: z.enum(['video', 'article', 'document', 'interview', 'dataset']),
    title: z.string().min(1),
    creator: z.string().min(1),
    duration: TimecodeSchema.optional(),
    captured_with: z.enum(['watch', 'manual', 'import']),
    artifact_note: z.string().min(1),
  })
  .strict();

const EvidenceArtifactSchema = z
  .object({
    type: z.enum(['transcript', 'frame']),
    ref: WatchArtifactReferenceSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    const isTranscript = artifact.ref.includes(':captions@');
    if (
      (artifact.type === 'transcript' && !isTranscript) ||
      (artifact.type === 'frame' && isTranscript)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `artifact type ${artifact.type} does not match its portable Watch reference`,
        path: ['ref'],
      });
    }
  });

const PriceValueSchema = z
  .object({
    offering: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-style currency code'),
    amount: z.number().nonnegative(),
    cadence: z.enum(['one_time', 'hourly', 'monthly', 'unspecified']),
    qualifier: z.string().min(1).optional(),
  })
  .strict();

const ResearchClaimSchema = z
  .object({
    type: z.enum(['price', 'revenue', 'market', 'performance', 'offer_value']),
    presenter_reported: z.boolean(),
    validation: z.enum(['unvalidated', 'partially_validated', 'validated']),
    values: z.array(PriceValueSchema).min(1).optional(),
  })
  .strict()
  .superRefine((claim, context) => {
    if (claim.type === 'price' && !claim.values?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'price claim requires one or more structured values',
        path: ['values'],
      });
    }
    if (claim.type !== 'price' && claim.values) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'structured price values are only valid for price claims',
        path: ['values'],
      });
    }
  });

const ResearchEvidenceSchema = z
  .object({
    id: IdentifierSchema,
    source_id: IdentifierSchema,
    observed_at: TimeRangeSchema,
    kind: z.enum(['method', 'feature', 'workflow', 'offer', 'claim', 'conflict']),
    observation: z.string().min(1),
    observed_labels: z.array(z.string().min(1)).min(1).optional(),
    confidence: z.enum(['low', 'medium', 'high']),
    verification: z.enum(['observed', 'presenter_reported', 'needs_research', 'validated']),
    conflict_note: z.string().min(1).optional(),
    atlas_interpretation: z.string().min(1),
    capability_ids: z.array(CapabilityIdSchema),
    specification: RepositorySpecificationSchema,
    artifacts: z.array(EvidenceArtifactSchema).min(1),
    claim: ResearchClaimSchema.optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const [observationStart, observationEnd] = rangeBounds(evidence.observed_at);
    if (observationStart > observationEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'observation range must be chronological',
        path: ['observed_at'],
      });
    }
    if (
      evidence.observed_labels &&
      !evidence.artifacts.some((artifact) => artifact.type === 'frame')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'on-screen labels require frame evidence',
        path: ['artifacts'],
      });
    }
    evidence.artifacts.forEach((artifact, index) => {
      const artifactVideoId = artifact.ref.split(':')[1];
      if (`video-${artifactVideoId.toLowerCase()}` !== evidence.source_id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'artifact references a different source video',
          path: ['artifacts', index, 'ref'],
        });
      }
      const artifactRange = artifact.ref.slice(artifact.ref.lastIndexOf('@') + 1);
      const [artifactStart, artifactEnd] = rangeBounds(artifactRange);
      if (
        artifactStart > artifactEnd ||
        artifactStart < observationStart ||
        artifactEnd > observationEnd
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'artifact timestamp is outside the declared observation range',
          path: ['artifacts', index, 'ref'],
        });
      }
    });
    if (new Set(evidence.capability_ids).size !== evidence.capability_ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate capability ID',
        path: ['capability_ids'],
      });
    }
    if (evidence.kind === 'claim') {
      if (!evidence.conflict_note) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'claim requires a conflict note',
          path: ['conflict_note'],
        });
      }
      if (!evidence.claim) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'claim evidence requires structured claim details',
          path: ['claim'],
        });
      }
    } else if (evidence.claim) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'structured claim details require kind: claim',
        path: ['claim'],
      });
    }
    if (
      evidence.kind === 'claim' &&
      evidence.claim?.type === 'price' &&
      evidence.claim.presenter_reported &&
      (evidence.verification === 'validated' || evidence.claim.validation === 'validated')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a presenter-reported price cannot be marked validated',
        path: ['verification'],
      });
    }
  });

export const ResearchLedgerSchema = z
  .object({
    schema_version: z.literal(1),
    sources: z.array(ResearchSourceSchema).min(1),
    evidence: z.array(ResearchEvidenceSchema).min(1),
  })
  .strict()
  .superRefine((ledger, context) => {
    const sourceIds = new Set<string>();
    ledger.sources.forEach((source, index) => {
      if (sourceIds.has(source.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate source id: ${source.id}`,
          path: ['sources', index, 'id'],
        });
      }
      sourceIds.add(source.id);
    });

    const evidenceIds = new Set<string>();
    ledger.evidence.forEach((evidence, index) => {
      if (evidenceIds.has(evidence.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate evidence id: ${evidence.id}`,
          path: ['evidence', index, 'id'],
        });
      }
      evidenceIds.add(evidence.id);
      if (!sourceIds.has(evidence.source_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown source id: ${evidence.source_id}`,
          path: ['evidence', index, 'source_id'],
        });
      }
    });
  });

const CapabilityCandidateSchema = z
  .object({
    id: CapabilityIdSchema,
    stage: CapabilityStageSchema,
    phase: z.enum(['P1', 'P2A', 'P2B', 'P2C', 'P3']),
    implementation: z.enum(['build', 'integrate', 'partner', 'research']),
    menu_group: z.string().min(1),
    atlas_description: z.string().min(1),
    evidence_ids: z.array(IdentifierSchema).min(1),
    specification: RepositorySpecificationSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    if (new Set(candidate.evidence_ids).size !== candidate.evidence_ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate evidence ID',
        path: ['evidence_ids'],
      });
    }
  });

export const CapabilityCandidatesSchema = z
  .object({
    schema_version: z.literal(1),
    candidates: z.array(CapabilityCandidateSchema),
  })
  .strict()
  .superRefine((file, context) => {
    const ids = new Set<string>();
    file.candidates.forEach((candidate, index) => {
      if (ids.has(candidate.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate candidate id: ${candidate.id}`,
          path: ['candidates', index, 'id'],
        });
      }
      ids.add(candidate.id);
    });
  });

export type ResearchLedger = z.infer<typeof ResearchLedgerSchema>;
export type CapabilityCandidates = z.infer<typeof CapabilityCandidatesSchema>;

export interface ResearchIntegrityInput {
  ledger: ResearchLedger;
  candidates: CapabilityCandidates;
  executableCapabilityIds: readonly string[];
  capabilityEvidenceIds: Readonly<Record<string, readonly string[]>>;
}

export function assertResearchIntegrity(input: ResearchIntegrityInput): void {
  const evidenceIds = new Set(input.ledger.evidence.map((evidence) => evidence.id));
  const executableIds = new Set(input.executableCapabilityIds);
  const candidateIds = new Set(input.candidates.candidates.map((candidate) => candidate.id));
  const failures: string[] = [];

  for (const [capabilityId, referencedEvidenceIds] of Object.entries(
    input.capabilityEvidenceIds,
  )) {
    if (!executableIds.has(capabilityId)) {
      failures.push(`capability metadata key ${capabilityId} is not executable`);
    }
    for (const referencedEvidenceId of referencedEvidenceIds) {
      if (!evidenceIds.has(referencedEvidenceId)) {
        failures.push(
          `capability ${capabilityId} evidence ${referencedEvidenceId} is absent from the research ledger`,
        );
      }
    }
  }

  for (const evidence of input.ledger.evidence) {
    for (const capabilityId of evidence.capability_ids) {
      if (!executableIds.has(capabilityId) && !candidateIds.has(capabilityId)) {
        failures.push(
          `ledger capability ${capabilityId} is neither executable nor staged as a candidate`,
        );
      } else if (
        executableIds.has(capabilityId) &&
        !input.capabilityEvidenceIds[capabilityId]?.includes(evidence.id)
      ) {
        failures.push(
          `executable capability ${capabilityId} evidence ${evidence.id} is missing from capability metadata`,
        );
      } else if (
        candidateIds.has(capabilityId) &&
        !input.candidates.candidates
          .find((candidate) => candidate.id === capabilityId)
          ?.evidence_ids.includes(evidence.id)
      ) {
        failures.push(
          `staged capability ${capabilityId} evidence ${evidence.id} is missing from candidate metadata`,
        );
      }
    }
  }

  for (const candidate of input.candidates.candidates) {
    if (executableIds.has(candidate.id)) {
      failures.push(`candidate ${candidate.id} duplicates an executable capability`);
    }
    for (const referencedEvidenceId of candidate.evidence_ids) {
      if (!evidenceIds.has(referencedEvidenceId)) {
        failures.push(
          `candidate ${candidate.id} references absent evidence ${referencedEvidenceId}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.sort().join('\n'));
  }
}

export async function loadResearchFiles(root: string): Promise<{
  ledger: ResearchLedger;
  candidates: CapabilityCandidates;
}> {
  const controlRoot = join(root, 'docs', 'control');
  const [ledgerYaml, candidatesYaml] = await Promise.all([
    readFile(join(controlRoot, 'RESEARCH_LEDGER.yaml'), 'utf8'),
    readFile(join(controlRoot, 'CAPABILITY_CANDIDATES.yaml'), 'utf8'),
  ]);

  return {
    ledger: ResearchLedgerSchema.parse(parse(ledgerYaml)),
    candidates: CapabilityCandidatesSchema.parse(parse(candidatesYaml)),
  };
}

export async function assertRepositoryResearchIntegrity(root: string): Promise<void> {
  const { ledger, candidates } = await loadResearchFiles(root);
  const registryUrl = pathToFileURL(join(root, 'packages', 'registry', 'registry.ts')).href;
  const metadataUrl = pathToFileURL(join(root, 'packages', 'registry', 'metadata.ts')).href;
  const registryModule = (await import(/* @vite-ignore */ registryUrl)) as {
    registry: Array<{ id: string }>;
  };
  const metadataModule = (await import(/* @vite-ignore */ metadataUrl)) as {
    capabilityMetadata: Record<string, { evidenceIds: string[] }>;
  };

  assertResearchIntegrity({
    ledger,
    candidates,
    executableCapabilityIds: registryModule.registry.map((capability) => capability.id),
    capabilityEvidenceIds: Object.fromEntries(
      Object.entries(metadataModule.capabilityMetadata).map(([id, metadata]) => [
        id,
        metadata.evidenceIds,
      ]),
    ),
  });
}
