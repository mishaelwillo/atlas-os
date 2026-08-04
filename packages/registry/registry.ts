/**
 * ATLAS OS — Capability Registry (Fable lane; spec §1.3)
 * ------------------------------------------------------
 * THE single source of truth for every capability the OS exposes.
 * Codegen derives from this file:
 *   - Fastify routes  (apps/api/src/routes.gen.ts)
 *   - Typed client    (packages/client/src/client.gen.ts)  → used by Mission Control UI
 *   - Mission Control cards (apps/os reads the registry at build time)
 * RULE: a capability not in this registry does not exist. No hand-wired routes.
 * RULE: changes to `requiresApproval` or `scopes` require Fable review.
 */

export type TaskClass = 'think' | 'do' | 'quick';

export interface Capability {
  /** dot-namespaced id, e.g. 'memory.answer' */
  id: string;
  name: string;
  description: string;
  /** JSON-schema for input/output — enforced at the route boundary */
  input: object;
  output: object;
  /** routing hint (§7): think→frontier(budgeted), do→cheap chain, quick→smallest */
  taskClass: TaskClass;
  /** if true, execution enqueues an approvals row and halts until decided */
  requiresApproval: boolean;
  /** api_tokens scopes allowed to call this (operator always may) */
  scopes: string[];
  /** GET|POST — GETs must be side-effect-free */
  method: 'GET' | 'POST';
  /**
   * How a run of this capability produces its result.
   *
   * `handler` means the capability's own code does the work and a run must
   * invoke it. `model` means the deliverable is a model's answer, routed by
   * task class.
   *
   * Required, not defaulted. `runs.execute` used to send every non-approval
   * capability to the model router, so scheduling a deterministic check
   * recorded a `succeeded` run for work that never happened. A default would
   * put the next capability back in that hole; declaring it is the point.
   *
   * Approval-gated capabilities never reach either path — the approval gate
   * short-circuits first — but they still declare it honestly.
   */
  execution: 'handler' | 'model';
}

export const registry = [
  // ---- memory (§6) ----
  {
    id: 'memory.answer',
    name: 'Answer from memory',
    description: 'Token-ladder answer: cache → playbook → nodes → model. Returns rung used + tokens spent.',
    input: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, budget: { type: 'number' } } },
    output: { type: 'object', properties: { answer: { type: 'string' }, rung: { enum: ['cache', 'playbook', 'nodes', 'model'] }, confidence: { type: 'number' }, tokensSpent: { type: 'number' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['memory:read'], method: 'POST', execution: 'model',
  },
  {
    id: 'memory.ingest',
    name: 'Ingest cards',
    description: 'Local ingest agent pushes relevance-filtered cards (hash-deduped).',
    input: { type: 'object', required: ['cards'], properties: { cards: { type: 'array' } } },
    // `quarantined` counts source-free cards held for review (P2A); it is
    // additive and absent from pre-P2A responses.
    output: { type: 'object', properties: { admitted: { type: 'number' }, skipped: { type: 'number' }, quarantined: { type: 'number' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['memory:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'memory.distill',
    name: 'Distill cards → nodes',
    description: 'Scheduled: raw cards → decision-memory nodes (kind: fact|decision|procedure|preference) with truth filter.',
    input: { type: 'object', properties: { limit: { type: 'number' } } },
    output: { type: 'object', properties: { nodes: { type: 'number' }, conflicts: { type: 'number' } } },
    taskClass: 'do', requiresApproval: false, scopes: [], method: 'POST', execution: 'model',
  },
  {
    id: 'memory.adjudicate',
    name: 'Truth review decision',
    description: 'Operator resolves a conflicted node (declarative approval UI).',
    input: { type: 'object', required: ['nodeId', 'verdict'], properties: { nodeId: { type: 'string' }, verdict: { enum: ['verified', 'probable', 'quarantined'] } } },
    output: { type: 'object' },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST', execution: 'handler',
  },

  // ---- runs & routing (§7) ----
  {
    id: 'runs.execute',
    name: 'Execute capability run',
    description: 'Create + run a capability with router-selected model; logs tokens/cost/rung.',
    input: { type: 'object', required: ['capability'], properties: { capability: { type: 'string' }, input: { type: 'object' } } },
    output: { type: 'object', properties: { runId: { type: 'string' }, status: { type: 'string' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['runs:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'playbooks.author',
    name: 'Author playbook (departing genius)',
    description: 'Budgeted frontier session whose deliverable is a versioned playbook. Always logged as think-class spend.',
    input: { type: 'object', required: ['taskFamily'], properties: { taskFamily: { type: 'string' }, brief: { type: 'string' } } },
    output: { type: 'object', properties: { playbookId: { type: 'string' }, version: { type: 'number' } } },
    taskClass: 'think', requiresApproval: true, scopes: [], method: 'POST', execution: 'handler',
  },

  // ---- factory (§5) ----
  {
    id: 'factory.build_site',
    name: 'Build wedge site',
    description: 'GBP/FB profile → facts → declarative descriptor → template render → preview deploy.',
    // `facts` carries the research dossier until directory adapters exist; each
    // entry needs a sourceUrl or ownerProvided, or it is blocked, not rendered.
    input: { type: 'object', required: ['profileUrl'], properties: { profileUrl: { type: 'string' }, region: { type: 'string' }, template: { type: 'string' }, stylePack: { type: 'string' }, facts: { type: 'array' } } },
    output: { type: 'object', properties: { siteId: { type: 'string' }, previewUrl: { type: 'string' }, status: { type: 'string' }, created: { type: 'boolean' }, factCount: { type: 'number' }, blocked: { type: 'array' }, buildHash: { type: 'string' }, renderIssues: { type: 'array' }, qa: { type: 'object' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['factory:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'factory.preview',
    name: 'Preview built site',
    description: 'Re-render a stored descriptor and return the immutable build. Access-controlled, expiring, noindex — never public.',
    input: { type: 'object', required: ['siteId'], properties: { siteId: { type: 'string' } } },
    output: { type: 'object', properties: { html: { type: 'string' }, hash: { type: 'string' }, expiresAt: { type: 'string' }, expired: { type: 'boolean' }, issues: { type: 'array' }, qa: { type: 'object' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['factory:write'], method: 'GET', execution: 'handler',
  },
  {
    id: 'factory.deploy_site',
    name: 'Deploy site live',
    description: 'Promote a demo site to live hosting. Deploys are governed. Required accessibility, responsive, link, structured-data, privacy, security and performance checks are re-run before an approval is created and again before the build is promoted.',
    input: { type: 'object', required: ['siteId'], properties: { siteId: { type: 'string' }, domain: { type: 'string' } } },
    output: { type: 'object', properties: { deployUrl: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST', execution: 'handler',
  },
  {
    id: 'factory.revise_site',
    name: 'Revise a site',
    description: 'Replace a site descriptor with a new set of facts. Touches the draft only: the live deployment keeps serving the bytes it published. Every sourcing and QA rule applies again, because new facts deserve the same scrutiny as the first ones.',
    input: { type: 'object', required: ['siteId', 'facts'], properties: { siteId: { type: 'string' }, facts: { type: 'array' }, template: { type: 'string' }, stylePack: { type: 'string' }, region: { type: 'string' } } },
    output: { type: 'object', properties: { siteId: { type: 'string' }, revised: { type: 'boolean' }, status: { type: 'string' }, factCount: { type: 'number' }, blocked: { type: 'array' }, buildHash: { type: 'string' }, renderIssues: { type: 'array' }, qa: { type: 'object' }, note: { type: 'string' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['factory:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'factory.unpublish',
    name: 'Withdraw a live site',
    description: 'Take a published site down. ALWAYS approval-gated. Every other live site is republished from the bytes it published, so withdrawing one cannot take another with it; if any of those bytes were never retained, the withdrawal is refused rather than risking that.',
    input: { type: 'object', required: ['siteId'], properties: { siteId: { type: 'string' } } },
    output: { type: 'object', properties: { approvalId: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST', execution: 'handler',
  },
  {
    id: 'factory.rollback',
    name: 'Roll a site back',
    description: 'Restore the last build that was observed serving. ALWAYS approval-gated. Only a deployment that actually went live and whose exact bytes were retained qualifies; the restore is a new version, never a revived row.',
    input: { type: 'object', required: ['siteId'], properties: { siteId: { type: 'string' } } },
    output: { type: 'object', properties: { approvalId: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST', execution: 'handler',
  },
  {
    id: 'leads.find',
    name: 'Find leads',
    description: 'Industry + location + criteria → scored lead table (active GBP, no website).',
    input: { type: 'object', required: ['industry', 'location'], properties: { industry: { type: 'string' }, location: { type: 'string' }, limit: { type: 'number' } } },
    output: { type: 'object', properties: { leads: { type: 'array' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['leads:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'prospecting.qualify',
    name: 'Qualify prospect',
    description: 'Score one sourced prospect against the pilot rubric and record an append-only assessment. Settled blockers disqualify; open questions send it to eligibility review. Never writes leads.status, which is the outreach lifecycle.',
    // `evidence` carries the rubric inputs. The verdict is derived from them,
    // not supplied, so two operators cannot reach different totals.
    input: { type: 'object', required: ['leadId', 'evidence'], properties: { leadId: { type: 'string' }, evidence: { type: 'object' } } },
    output: { type: 'object', properties: { assessmentId: { type: 'string' }, verdict: { type: 'string' }, total: { type: 'number' }, scores: { type: 'object' }, blockers: { type: 'array' }, unknowns: { type: 'array' }, expiresAt: { type: 'string' }, status: { type: 'string' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['leads:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'prospecting.workspace',
    name: 'Prospecting workspace',
    description: 'Review sourced prospects with their standing qualification verdict, demo slot and outreach readiness. Read-only; it decides nothing.',
    input: { type: 'object', properties: { verdict: { type: 'string' }, limit: { type: 'number' } } },
    output: { type: 'object', properties: { prospects: { type: 'array' }, queue: { type: 'object' }, status: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['leads:write'], method: 'GET', execution: 'handler',
  },
  {
    id: 'demos.enqueue',
    name: 'Take a demo slot',
    description: 'Admit a qualified prospect to the demo queue. Refuses an unqualified or stale prospect, a prospect already holding a slot, and anything over the pilot cap of ten.',
    input: { type: 'object', required: ['leadId'], properties: { leadId: { type: 'string' } } },
    output: { type: 'object', properties: { queueId: { type: 'string' }, state: { type: 'string' }, remaining: { type: 'number' }, belowFloor: { type: 'boolean' }, expiresAt: { type: 'string' }, status: { type: 'string' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['leads:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'demos.advance',
    name: 'Move a demo along',
    description: 'Advance one demo slot by exactly one declared step, or expire it. A demo cannot jump past QA, and cannot be rewound.',
    input: { type: 'object', required: ['queueId', 'state'], properties: { queueId: { type: 'string' }, state: { type: 'string' }, siteId: { type: 'string' } } },
    output: { type: 'object', properties: { queueId: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, status: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['leads:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'outreach.send',
    name: 'Send outreach message',
    description: 'One outreach touch (email/SMS/WhatsApp draft). ALWAYS approval-gated. Suppressed leads and a per-space daily cap are refused before an approval is created.',
    input: { type: 'object', required: ['leadId', 'channel', 'body'], properties: { leadId: { type: 'string' }, channel: { type: 'string' }, body: { type: 'string' }, touchId: { type: 'string' } } },
    output: { type: 'object', properties: { approvalId: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST', execution: 'handler',
  },
  {
    id: 'automation.sequence',
    name: 'Plan an outreach sequence',
    description: 'Plan an ordered set of touches for one lead. Planning creates drafts only: each touch still needs its own policy check and its own named approval, and no touch can be sent from here. A suppressed lead cannot be sequenced.',
    input: { type: 'object', required: ['leadId', 'channels'], properties: { leadId: { type: 'string' }, channels: { type: 'array' } } },
    output: { type: 'object', properties: { sequenceId: { type: 'string' }, version: { type: 'number' }, state: { type: 'string' }, steps: { type: 'array' }, planned: { type: 'boolean' }, code: { type: 'string' }, status: { type: 'string' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['leads:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'sequence.advance',
    name: 'Record a touch outcome',
    description: 'Move one touch by exactly one declared step. Approval requires a real approved approvals row; recording a touch as sent is refused here and is only ever done by the approved outreach.send dispatch. A reply or an opt-out stops the sequence.',
    input: { type: 'object', required: ['touchId', 'state'], properties: { touchId: { type: 'string' }, state: { type: 'string' }, approvalId: { type: 'string' } } },
    output: { type: 'object', properties: { touchId: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, sequenceState: { type: 'string' }, stopped: { type: 'boolean' }, advanced: { type: 'boolean' }, code: { type: 'string' }, status: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['leads:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'sequence.state',
    name: 'Outreach sequence state',
    description: 'The plan for one lead, what happened to each touch, and which touch is eligible next — or why none is. Read-only.',
    input: { type: 'object', required: ['leadId'], properties: { leadId: { type: 'string' } } },
    output: { type: 'object', properties: { found: { type: 'boolean' }, sequenceId: { type: 'string' }, version: { type: 'number' }, state: { type: 'string' }, stoppedReason: { type: 'string' }, touches: { type: 'array' }, next: { type: 'object' }, status: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['leads:write'], method: 'GET', execution: 'handler',
  },
  {
    id: 'offers.publish',
    name: 'Publish an offer version',
    description: 'Record an immutable offer for one lead. Country, currency, price, period and terms version are all required — there is no default price and no USD assumption — and every disclosure the pilot requires must carry text. A change is a new version, never an edit.',
    input: { type: 'object', required: ['leadId', 'country', 'currency', 'priceMinor', 'period', 'termsVersion', 'disclosures'], properties: { leadId: { type: 'string' }, country: { type: 'string' }, currency: { type: 'string' }, priceMinor: { type: 'number' }, period: { type: 'string' }, termsVersion: { type: 'string' }, disclosures: { type: 'object' } } },
    output: { type: 'object', properties: { offerId: { type: 'string' }, version: { type: 'number' }, currency: { type: 'string' }, priceMinor: { type: 'number' }, period: { type: 'string' }, country: { type: 'string' }, supersedes: { type: 'number' }, published: { type: 'boolean' }, code: { type: 'string' }, missing: { type: 'array' }, required: { type: 'array' }, status: { type: 'string' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['leads:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'deals.decide',
    name: 'Record a deal decision',
    description: 'Record where a deal has got to: interested, discovery, offer_review, accepted or declined. Operator-only — it records a human decision, it does not make one. Reviewing or accepting requires a published offer version.',
    input: { type: 'object', required: ['leadId', 'state'], properties: { leadId: { type: 'string' }, state: { type: 'string' }, offerVersion: { type: 'number' }, notes: { type: 'string' } } },
    output: { type: 'object', properties: { decisionId: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, offerVersion: { type: 'number' }, decided: { type: 'boolean' }, code: { type: 'string' }, status: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: [], method: 'POST', execution: 'handler',
  },
  {
    id: 'hosting.activate',
    name: 'Activate hosting',
    description: 'Grant a customer hosting. ALWAYS approval-gated. Refused before an approval is created, and again before the entitlement moves, unless terms were accepted on this exact offer version with every required disclosure and a payment reference is recorded. Atlas never confirms a payment itself.',
    input: { type: 'object', required: ['leadId'], properties: { leadId: { type: 'string' } } },
    output: { type: 'object', properties: { approvalId: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST', execution: 'handler',
  },
  {
    id: 'hosting.cancel',
    name: 'Cancel hosting',
    description: 'Disable renewal for a customer. ALWAYS approval-gated. Deletes no history, offer or export, and a customer who paid for the period keeps it.',
    input: { type: 'object', required: ['leadId'], properties: { leadId: { type: 'string' }, servesUntil: { type: 'string' } } },
    output: { type: 'object', properties: { approvalId: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST', execution: 'handler',
  },
  {
    id: 'hosting.state',
    name: 'Hosting state',
    description: 'The standing offer, deal decision and hosting entitlement for one lead. Read-only, and it never returns the payment reference itself — only whether one exists.',
    input: { type: 'object', required: ['leadId'], properties: { leadId: { type: 'string' } } },
    output: { type: 'object', properties: { offer: { type: 'object' }, deal: { type: 'object' }, entitlement: { type: 'object' }, status: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['leads:write'], method: 'GET', execution: 'handler',
  },
  {
    id: 'analytics.funnel',
    name: 'Revenue pilot funnel',
    description: 'Counts at every pilot stage with conversion between them, per-channel counts that attribute nothing, and revenue per currency. A rate with no denominator is reported as unknown, never as zero, and metrics nothing records are named rather than defaulted.',
    input: { type: 'object', properties: {} },
    output: { type: 'object', properties: { stages: { type: 'array' }, rates: { type: 'object' }, revenue: { type: 'object' }, unavailable: { type: 'array' }, empty: { type: 'boolean' }, channelContribution: { type: 'object' }, topBlockers: { type: 'array' }, status: { type: 'string' }, note: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['leads:write'], method: 'GET', execution: 'handler',
  },
  {
    id: 'factory.verify_live',
    name: 'Verify live sites',
    description: 'Read every live deployment back and compare what its address serves against the build approved for it. Changes no deployment state: a site that has gone wrong is still the site that is public. Records the observation and names what is wrong.',
    input: { type: 'object', properties: {} },
    output: { type: 'object', properties: { checked: { type: 'number' }, matching: { type: 'number' }, healthy: { type: 'boolean' }, mismatched: { type: 'array' }, unreadable: { type: 'array' }, status: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['factory:write'], method: 'POST', execution: 'handler',
  },
  {
    id: 'events.site',
    name: 'Site event webhook',
    description: 'Deployed sites post form/chat/call events here → conversation + qualification workflow.',
    input: { type: 'object', required: ['siteId', 'channel', 'payload'], properties: { siteId: { type: 'string' }, channel: { type: 'string' }, payload: { type: 'object' } } },
    output: { type: 'object', properties: { conversationId: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['events:write'], method: 'POST', execution: 'handler',
  },

  // ---- governance & ops ----
  {
    id: 'approvals.list',
    name: 'List pending approvals',
    description: 'Pending approval queue for the declarative approval UI.',
    input: { type: 'object' },
    output: { type: 'object', properties: { approvals: { type: 'array' } } },
    taskClass: 'quick', requiresApproval: false, scopes: [], method: 'GET', execution: 'handler',
  },
  {
    id: 'approvals.decide',
    name: 'Decide approval',
    description: 'Operator-only: approve/reject/defer with notes. Executes held action on approve.',
    input: { type: 'object', required: ['approvalId', 'decision'], properties: { approvalId: { type: 'string' }, decision: { enum: ['approved', 'rejected'] }, notes: { type: 'string' } } },
    output: { type: 'object' },
    taskClass: 'quick', requiresApproval: false, scopes: [], method: 'POST', execution: 'handler', // operator-only enforced by RLS + route guard
  },
  {
    id: 'status.mission_control',
    name: 'Mission Control status',
    description: 'Home cards: model-chain health, memory freshness, cache-hit rate, $ saved, live runs, pending approvals.',
    input: { type: 'object' },
    output: { type: 'object' },
    taskClass: 'quick', requiresApproval: false, scopes: [], method: 'GET', execution: 'handler',
  },
  {
    id: 'bench.run',
    name: 'Run model bench',
    description: 'Scheduled: score models on eval task families; results feed the router.',
    input: { type: 'object', properties: { taskFamily: { type: 'string' } } },
    output: { type: 'object', properties: { results: { type: 'array' } } },
    taskClass: 'do', requiresApproval: false, scopes: [], method: 'POST', execution: 'handler',
  },
] satisfies Capability[];

export type CapabilityId = (typeof registry)[number]['id'];
export const REGISTRY_VERSION = 3;

/** Codegen contract (implemented in Codex lane, P1):
 *  - route path = '/v1/' + id.replace('.', '/')   e.g. POST /v1/memory/answer
 *  - every handler wraps: auth → scope check → input validation → audit_log insert → execute → output validation
 *  - requiresApproval capabilities insert approvals row + return {approvalId, status:'review'} instead of executing
 *  - GET handlers must be side-effect-free (enforced by review, asserted in tests)
 */
