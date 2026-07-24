import type { CapabilityId } from './registry.js';

export type CapabilityStage =
  | 'observed'
  | 'catalogued'
  | 'candidate'
  | 'experiment'
  | 'validated'
  | 'production'
  | 'core'
  | 'deferred'
  | 'integration-only'
  | 'rejected'
  | 'superseded'
  | 'retired';

export type ImplementationMode = 'build' | 'integrate' | 'partner' | 'research';

export type MonetizationRole =
  | 'platform'
  | 'acquisition'
  | 'hosting'
  | 'upsell'
  | 'operations';

export interface CapabilityMetadata {
  stage: CapabilityStage;
  phase: 'P1' | 'P2A' | 'P2B' | 'P2C' | 'P3';
  menuGroup: string;
  regions: string[];
  entitlements: string[];
  monetization: MonetizationRole;
  implementation: ImplementationMode;
  autonomy: 'manual' | 'shadow' | 'threshold' | 'full-auto';
  evidenceIds: string[];
  specification: string;
}

const P1_SPECIFICATION = 'briefs/P1-CODEX-services.md';
const P2_SPECIFICATION = 'docs/control/CONTINUITY_DESIGN.md';

export const capabilityMetadata: Record<CapabilityId, CapabilityMetadata> = {
  'memory.answer': {
    stage: 'core',
    phase: 'P1',
    menuGroup: 'Intelligence Bank',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'platform',
    implementation: 'build',
    autonomy: 'threshold',
    evidenceIds: [],
    specification: P1_SPECIFICATION,
  },
  'memory.ingest': {
    stage: 'core',
    phase: 'P1',
    menuGroup: 'Intelligence Bank',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'operations',
    implementation: 'build',
    autonomy: 'threshold',
    evidenceIds: [],
    specification: P1_SPECIFICATION,
  },
  'memory.distill': {
    stage: 'core',
    phase: 'P1',
    menuGroup: 'Intelligence Bank',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'operations',
    implementation: 'build',
    autonomy: 'threshold',
    evidenceIds: [],
    specification: P1_SPECIFICATION,
  },
  'memory.adjudicate': {
    stage: 'core',
    phase: 'P1',
    menuGroup: 'Intelligence Bank',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'operations',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: [],
    specification: P1_SPECIFICATION,
  },
  'runs.execute': {
    stage: 'core',
    phase: 'P1',
    menuGroup: 'Runs',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'platform',
    implementation: 'build',
    autonomy: 'threshold',
    evidenceIds: [],
    specification: P1_SPECIFICATION,
  },
  'playbooks.author': {
    stage: 'candidate',
    phase: 'P2A',
    menuGroup: 'Intelligence Bank',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'operations',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: [],
    specification: P2_SPECIFICATION,
  },
  'factory.build_site': {
    stage: 'candidate',
    phase: 'P2B',
    menuGroup: 'Website Factory',
    regions: ['global'],
    entitlements: ['website-factory'],
    monetization: 'acquisition',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: [],
    specification: P2_SPECIFICATION,
  },
  'factory.deploy_site': {
    stage: 'candidate',
    phase: 'P2B',
    menuGroup: 'Website Factory',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    autonomy: 'shadow',
    evidenceIds: [],
    specification: P2_SPECIFICATION,
  },
  'leads.find': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Prospecting',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'integrate',
    autonomy: 'manual',
    evidenceIds: [],
    specification: P2_SPECIFICATION,
  },
  'outreach.send': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Outreach',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'integrate',
    autonomy: 'shadow',
    evidenceIds: [],
    specification: P2_SPECIFICATION,
  },
  'events.site': {
    stage: 'candidate',
    phase: 'P2B',
    menuGroup: 'Customer Engagement',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    autonomy: 'threshold',
    evidenceIds: [],
    specification: P2_SPECIFICATION,
  },
  'approvals.list': {
    stage: 'core',
    phase: 'P1',
    menuGroup: 'Governance',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'operations',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: [],
    specification: P1_SPECIFICATION,
  },
  'approvals.decide': {
    stage: 'core',
    phase: 'P1',
    menuGroup: 'Governance',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'operations',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: [],
    specification: P1_SPECIFICATION,
  },
  'status.mission_control': {
    stage: 'core',
    phase: 'P1',
    menuGroup: 'Mission Control',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'platform',
    implementation: 'build',
    autonomy: 'full-auto',
    evidenceIds: [],
    specification: P1_SPECIFICATION,
  },
  'bench.run': {
    stage: 'core',
    phase: 'P1',
    menuGroup: 'Model Operations',
    regions: ['global'],
    entitlements: ['platform'],
    monetization: 'operations',
    implementation: 'build',
    autonomy: 'threshold',
    evidenceIds: [],
    specification: P1_SPECIFICATION,
  },
};
