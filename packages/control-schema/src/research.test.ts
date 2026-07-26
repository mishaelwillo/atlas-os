import { describe, expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CapabilityCandidatesSchema,
  ResearchLedgerSchema,
  assertRepositoryResearchIntegrity,
  assertResearchIntegrity,
} from './research.js';

const evidenceId = 'video-qy0l1t7x6le-website-wedge';

const validLedger = {
  schema_version: 1,
  sources: [
    {
      id: 'video-qy0l1t7x6le',
      source_url: 'https://www.youtube.com/watch?v=QY0L1T7x6lE',
      source_type: 'video',
      title: 'AI Websites Are The Current Online Gold Rush (Not AI Agents)',
      creator: 'Nick Ponte',
      duration: '00:42:37',
      captured_with: 'watch',
      artifact_note:
        'Local Watch extraction; source IDs remain portable and raw media is not committed.',
    },
  ],
  evidence: [
    {
      id: evidenceId,
      source_id: 'video-qy0l1t7x6le',
      observed_at: '00:00:04-00:07:41',
      kind: 'method',
      observation:
        'The website is the familiar entry product; automation and agents operate underneath it.',
      confidence: 'high',
      verification: 'observed',
      conflict_note:
        'Presenter promotes an affiliate-linked platform and a related masterclass.',
      atlas_interpretation:
        'Use a website as the acquisition wedge without copying the vendor platform.',
      capability_ids: ['factory.build_site'],
      specification: 'docs/specs/p2/website-factory.md',
      artifacts: [
        {
          type: 'transcript',
          ref: 'watch:QY0L1T7x6lE:captions@00:00:04-00:07:41',
        },
        {
          type: 'frame',
          ref: 'watch:QY0L1T7x6lE:frame_0019@00:07:10',
        },
      ],
    },
    {
      id: 'video-qy0l1t7x6le-hosting-price',
      source_id: 'video-qy0l1t7x6le',
      observed_at: '00:12:23-00:12:55',
      kind: 'claim',
      observation: 'Presenter reports charging USD 100 or USD 119 plus tax for hosting.',
      confidence: 'high',
      verification: 'presenter_reported',
      conflict_note:
        'This is the presenter’s own offer and has not been validated against a market sample.',
      atlas_interpretation:
        'Treat the amount as a research input, never as an approved Atlas price.',
      capability_ids: ['factory.deploy_site'],
      specification: 'docs/specs/p2/revenue-pilot.md',
      artifacts: [
        {
          type: 'transcript',
          ref: 'watch:QY0L1T7x6lE:captions@00:12:37-00:12:55',
        },
        {
          type: 'frame',
          ref: 'watch:QY0L1T7x6lE:frame_0046@00:12:23',
        },
      ],
      claim: {
        type: 'price',
        presenter_reported: true,
        validation: 'unvalidated',
        values: [
          {
            offering: 'website hosting',
            currency: 'USD',
            amount: 100,
            cadence: 'monthly',
            qualifier: 'plus tax',
          },
        ],
      },
    },
  ],
};

const validCandidates = {
  schema_version: 1,
  candidates: [
    {
      id: 'conversations.inbox',
      stage: 'candidate',
      phase: 'P2B',
      implementation: 'build',
      menu_group: 'Customer Engagement',
      atlas_description: 'Unify inbound customer conversations.',
      evidence_ids: [evidenceId],
      specification: 'docs/specs/p2/website-factory.md',
    },
  ],
};

describe('research schemas', () => {
  test('accepts strict evidence and progressive candidate records', () => {
    expect(ResearchLedgerSchema.parse(validLedger).evidence).toHaveLength(2);
    expect(CapabilityCandidatesSchema.parse(validCandidates).candidates).toHaveLength(1);
  });

  test('rejects duplicate source, evidence, and candidate IDs', () => {
    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        sources: [...validLedger.sources, validLedger.sources[0]],
      }),
    ).toThrow(/duplicate source id/i);

    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [...validLedger.evidence, validLedger.evidence[0]],
      }),
    ).toThrow(/duplicate evidence id/i);

    expect(() =>
      CapabilityCandidatesSchema.parse({
        ...validCandidates,
        candidates: [...validCandidates.candidates, validCandidates.candidates[0]],
      }),
    ).toThrow(/duplicate candidate id/i);
  });

  test('rejects unknown evidence kinds and claim types', () => {
    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [{ ...validLedger.evidence[0], kind: 'opinion' }],
      }),
    ).toThrow();

    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [
          {
            ...validLedger.evidence[1],
            claim: { ...validLedger.evidence[1].claim, type: 'forecast' },
          },
        ],
      }),
    ).toThrow();
  });

  test('rejects unsafe specification and artifact references', () => {
    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [{ ...validLedger.evidence[0], specification: '../outside.md' }],
      }),
    ).toThrow(/repository-root-relative/i);

    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [
          {
            ...validLedger.evidence[0],
            artifacts: [
              {
                type: 'frame',
                ref: 'C:\\private\\frames\\frame_0019.jpg',
              },
            ],
          },
        ],
      }),
    ).toThrow(/portable Watch reference/i);
  });

  test('rejects artifact timestamps outside the declared observation range', () => {
    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [
          {
            ...validLedger.evidence[0],
            observed_at: '00:07:19-00:07:29',
            artifacts: [
              {
                type: 'frame',
                ref: 'watch:QY0L1T7x6lE:frame_0019@00:07:10',
              },
            ],
          },
        ],
      }),
    ).toThrow(/outside the declared observation range/i);
  });

  test('rejects Watch artifacts from a different source video', () => {
    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [
          {
            ...validLedger.evidence[0],
            artifacts: [
              {
                type: 'frame',
                ref: 'watch:AAAAAAAAAAA:frame_0019@00:07:10',
              },
            ],
          },
        ],
      }),
    ).toThrow(/different source video/i);
  });

  test('requires frame evidence for observed on-screen labels', () => {
    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [
          {
            ...validLedger.evidence[0],
            observed_labels: ['Dashboard'],
            artifacts: [validLedger.evidence[0].artifacts[0]],
          },
        ],
      }),
    ).toThrow(/on-screen labels require frame evidence/i);
  });

  test('requires claim conflict disclosure and structured claim details', () => {
    const { conflict_note: _conflictNote, ...withoutConflict } = validLedger.evidence[1];
    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [withoutConflict],
      }),
    ).toThrow(/conflict note/i);

    const { claim: _claim, ...withoutClaim } = validLedger.evidence[1];
    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [withoutClaim],
      }),
    ).toThrow(/claim details/i);
  });

  test('forbids validating presenter-reported prices', () => {
    expect(() =>
      ResearchLedgerSchema.parse({
        ...validLedger,
        evidence: [
          {
            ...validLedger.evidence[1],
            verification: 'validated',
            claim: {
              ...validLedger.evidence[1].claim,
              validation: 'validated',
            },
          },
        ],
      }),
    ).toThrow(/presenter-reported price/i);
  });
});

describe('research cross-reference integrity', () => {
  test('validates the committed ledger against executable registry authority', async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

    await expect(assertRepositoryResearchIntegrity(repositoryRoot)).resolves.toBeUndefined();
  });

  test('accepts executable and staged capability references', () => {
    expect(() =>
      assertResearchIntegrity({
        ledger: ResearchLedgerSchema.parse(validLedger),
        candidates: CapabilityCandidatesSchema.parse(validCandidates),
        executableCapabilityIds: ['factory.build_site', 'factory.deploy_site'],
        capabilityEvidenceIds: {
          'factory.build_site': [evidenceId],
          'factory.deploy_site': ['video-qy0l1t7x6le-hosting-price'],
        },
      }),
    ).not.toThrow();
  });

  test('rejects capability metadata evidence IDs absent from the ledger', () => {
    expect(() =>
      assertResearchIntegrity({
        ledger: ResearchLedgerSchema.parse(validLedger),
        candidates: CapabilityCandidatesSchema.parse(validCandidates),
        executableCapabilityIds: ['factory.build_site'],
        capabilityEvidenceIds: { 'factory.build_site': ['missing-evidence'] },
      }),
    ).toThrow(/missing-evidence.*absent from the research ledger/i);
  });

  test('rejects executable ledger evidence missing from capability metadata', () => {
    expect(() =>
      assertResearchIntegrity({
        ledger: ResearchLedgerSchema.parse(validLedger),
        candidates: CapabilityCandidatesSchema.parse(validCandidates),
        executableCapabilityIds: ['factory.build_site', 'factory.deploy_site'],
        capabilityEvidenceIds: {
          'factory.build_site': [evidenceId],
          'factory.deploy_site': [],
        },
      }),
    ).toThrow(/factory\.deploy_site.*hosting-price.*missing from capability metadata/i);
  });

  test('rejects ledger capability IDs absent from both registry and candidates', () => {
    const ledger = ResearchLedgerSchema.parse({
      ...validLedger,
      evidence: [
        {
          ...validLedger.evidence[0],
          capability_ids: ['untracked.capability'],
        },
      ],
    });

    expect(() =>
      assertResearchIntegrity({
        ledger,
        candidates: CapabilityCandidatesSchema.parse(validCandidates),
        executableCapabilityIds: ['factory.build_site'],
        capabilityEvidenceIds: {},
      }),
    ).toThrow(/untracked\.capability.*neither executable nor staged/i);
  });

  test('rejects staged ledger evidence missing from candidate metadata', () => {
    const ledger = ResearchLedgerSchema.parse({
      ...validLedger,
      evidence: [
        {
          ...validLedger.evidence[0],
          capability_ids: ['conversations.inbox'],
        },
      ],
    });
    const candidates = CapabilityCandidatesSchema.parse({
      ...validCandidates,
      candidates: [
        {
          ...validCandidates.candidates[0],
          evidence_ids: ['video-qy0l1t7x6le-hosting-price'],
        },
      ],
    });

    expect(() =>
      assertResearchIntegrity({
        ledger,
        candidates,
        executableCapabilityIds: [],
        capabilityEvidenceIds: {},
      }),
    ).toThrow(/conversations\.inbox.*website-wedge.*missing from candidate metadata/i);
  });

  test('rejects candidate evidence IDs absent from the ledger', () => {
    const candidates = CapabilityCandidatesSchema.parse({
      ...validCandidates,
      candidates: [
        {
          ...validCandidates.candidates[0],
          evidence_ids: ['missing-evidence'],
        },
      ],
    });

    expect(() =>
      assertResearchIntegrity({
        ledger: ResearchLedgerSchema.parse(validLedger),
        candidates,
        executableCapabilityIds: ['factory.build_site', 'factory.deploy_site'],
        capabilityEvidenceIds: {},
      }),
    ).toThrow(/candidate conversations\.inbox.*missing-evidence/i);
  });
});
