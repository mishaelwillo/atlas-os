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
const P2_INTELLIGENCE_SPECIFICATION = 'docs/specs/p2/intelligence-foundation.md';
const P2_FACTORY_SPECIFICATION = 'docs/specs/p2/website-factory.md';
const P2_REVENUE_SPECIFICATION = 'docs/specs/p2/revenue-pilot.md';

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
    specification: P2_INTELLIGENCE_SPECIFICATION,
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
    evidenceIds: [
      'video-qy0l1t7x6le-website-wedge',
      'video-qy0l1t7x6le-template-library',
      'video-qy0l1t7x6le-ai-assisted-editor',
      'video-qy0l1t7x6le-gbp-site-prompt',
      'video-qy0l1t7x6le-generation-stages',
      'video-qy0l1t7x6le-prebuild-demos',
    ],
    specification: P2_FACTORY_SPECIFICATION,
  },
  'factory.preview': {
    stage: 'candidate',
    phase: 'P2B',
    menuGroup: 'Website Factory',
    regions: ['global'],
    entitlements: ['website-factory'],
    monetization: 'acquisition',
    implementation: 'build',
    // Access-controlled and expiring; it publishes nothing on its own.
    autonomy: 'manual',
    // No video evidence names this capability. It derives from the preview
    // requirements in the owning specification, so no evidence is claimed.
    evidenceIds: [],
    specification: P2_FACTORY_SPECIFICATION,
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
    evidenceIds: [
      'video-qy0l1t7x6le-generation-stages',
      'video-qy0l1t7x6le-free-hosting-offer',
      'video-qy0l1t7x6le-presenter-pricing',
    ],
    specification: P2_FACTORY_SPECIFICATION,
  },
  'factory.revise_site': {
    stage: 'candidate',
    phase: 'P2B',
    menuGroup: 'Website Factory',
    regions: ['global'],
    entitlements: ['website-factory'],
    monetization: 'hosting',
    implementation: 'build',
    // Changes a draft only; publishing it is a separate approved step.
    autonomy: 'manual',
    evidenceIds: [],
    specification: P2_FACTORY_SPECIFICATION,
  },
  'factory.unpublish': {
    stage: 'candidate',
    phase: 'P2B',
    menuGroup: 'Website Factory',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    // Privileged and audited, like publishing and rollback.
    autonomy: 'shadow',
    evidenceIds: [],
    specification: P2_FACTORY_SPECIFICATION,
  },
  'factory.rollback': {
    stage: 'candidate',
    phase: 'P2B',
    menuGroup: 'Website Factory',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    // Privileged and audited, like publishing.
    autonomy: 'shadow',
    evidenceIds: [],
    specification: P2_FACTORY_SPECIFICATION,
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
    evidenceIds: ['video-qy0l1t7x6le-google-maps-prospecting'],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'leads.record': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Prospecting',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'build',
    // An operator types what they found and where it was found. Nothing is
    // scraped, nothing is inferred, and no contact is made.
    autonomy: 'manual',
    // The specification names hand sourcing as the pilot workflow before an
    // approved directory adapter exists. No video evidence is claimed for it.
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'prospecting.qualify': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Prospecting',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'build',
    // The rubric does arithmetic on evidence an operator supplied; it decides
    // nothing on its own and cannot contact anyone.
    autonomy: 'manual',
    // The rubric derives from the owning specification, not from the video.
    // No evidence is claimed for it.
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'prospecting.workspace': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Prospecting',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'build',
    // Read-only review surface.
    autonomy: 'manual',
    evidenceIds: [
      'video-qy0l1t7x6le-marketing-navigation',
      'video-qy0l1t7x6le-google-maps-prospecting',
      'video-qy0l1t7x6le-prebuild-demos',
    ],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'demos.enqueue': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Prospecting',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: ['video-qy0l1t7x6le-prebuild-demos'],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'demos.advance': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Prospecting',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: ['video-qy0l1t7x6le-prebuild-demos'],
    specification: P2_REVENUE_SPECIFICATION,
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
    evidenceIds: ['video-qy0l1t7x6le-multichannel-outreach'],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'automation.sequence': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Outreach',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'build',
    // Planning only. It cannot send, and it cannot record a send.
    autonomy: 'manual',
    evidenceIds: [
      'video-qy0l1t7x6le-dashboard-navigation',
      'video-qy0l1t7x6le-follow-up-automation',
    ],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'sequence.advance': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Outreach',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'build',
    autonomy: 'manual',
    // The touch state machine derives from the owning specification's outreach
    // workflow, not from the video. No evidence is claimed.
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'sequence.state': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Outreach',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'acquisition',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'offers.publish': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Revenue Operations',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'hosting',
    implementation: 'build',
    // Records an offer; it cannot decide or accept one.
    autonomy: 'manual',
    evidenceIds: ['video-qy0l1t7x6le-free-hosting-offer'],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'deals.decide': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Revenue Operations',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'hosting',
    implementation: 'build',
    // Records a decision a human made. Models cannot accept terms.
    autonomy: 'manual',
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'hosting.record_terms': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Revenue Operations',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    // An operator records a decision a customer made and, optionally, a
    // reference they read off the provider's console. Atlas confirms nothing.
    autonomy: 'manual',
    // The capability derives from the specification's hosting chain and from a
    // defect found by running the pilot, not from the video. Claiming the
    // free-hosting-offer evidence would attribute it to material that does not
    // name it.
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'hosting.activate': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Revenue Operations',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    // Approval-gated; the gate is decided twice, before and after.
    autonomy: 'shadow',
    evidenceIds: ['video-qy0l1t7x6le-free-hosting-offer'],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'hosting.cancel': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Revenue Operations',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    autonomy: 'shadow',
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'hosting.advance': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Revenue Operations',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    // An operator records how far delivery has got. Nothing is granted and no
    // external effect follows, so there is nothing for a model to shadow.
    autonomy: 'manual',
    // Derived from the specification's hosting chain and from a reachability
    // gap found by checking it, not from the video.
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'hosting.state': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Revenue Operations',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'pilot.record_cost': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Analytics',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    // An operator records a figure they observed. Nothing here is inferable.
    autonomy: 'manual',
    // Derives from the specification's exit criterion and analytics list, not
    // from the video.
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'pilot.record_outcome': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Analytics',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    autonomy: 'manual',
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'analytics.funnel': {
    stage: 'candidate',
    phase: 'P2C',
    menuGroup: 'Analytics',
    regions: ['global'],
    entitlements: ['revenue-pilot'],
    monetization: 'operations',
    implementation: 'build',
    // Read-only counting. It changes nothing and decides nothing.
    autonomy: 'full-auto',
    // The funnel derives from the owning specification's analytics list, not
    // from the video. No evidence is claimed.
    evidenceIds: [],
    specification: P2_REVENUE_SPECIFICATION,
  },
  'factory.verify_live': {
    stage: 'candidate',
    phase: 'P2B',
    menuGroup: 'Website Factory',
    regions: ['global'],
    entitlements: ['website-hosting'],
    monetization: 'hosting',
    implementation: 'build',
    // Reads addresses and records what it saw. It publishes nothing and
    // changes no deployment state.
    autonomy: 'full-auto',
    // Derives from the owning specification's fingerprint acceptance, not from
    // the video. No evidence is claimed.
    evidenceIds: [],
    specification: P2_FACTORY_SPECIFICATION,
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
    evidenceIds: [
      'video-qy0l1t7x6le-website-wedge',
      'video-qy0l1t7x6le-unified-conversations',
      'video-qy0l1t7x6le-follow-up-automation',
    ],
    specification: P2_FACTORY_SPECIFICATION,
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
