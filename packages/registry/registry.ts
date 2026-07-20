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
}

export const registry: Capability[] = [
  // ---- memory (§6) ----
  {
    id: 'memory.answer',
    name: 'Answer from memory',
    description: 'Token-ladder answer: cache → playbook → nodes → model. Returns rung used + tokens spent.',
    input: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, budget: { type: 'number' } } },
    output: { type: 'object', properties: { answer: { type: 'string' }, rung: { enum: ['cache', 'playbook', 'nodes', 'model'] }, confidence: { type: 'number' }, tokensSpent: { type: 'number' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['memory:read'], method: 'POST',
  },
  {
    id: 'memory.ingest',
    name: 'Ingest cards',
    description: 'Local ingest agent pushes relevance-filtered cards (hash-deduped).',
    input: { type: 'object', required: ['cards'], properties: { cards: { type: 'array' } } },
    output: { type: 'object', properties: { admitted: { type: 'number' }, skipped: { type: 'number' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['memory:write'], method: 'POST',
  },
  {
    id: 'memory.distill',
    name: 'Distill cards → nodes',
    description: 'Scheduled: raw cards → decision-memory nodes (kind: fact|decision|procedure|preference) with truth filter.',
    input: { type: 'object', properties: { limit: { type: 'number' } } },
    output: { type: 'object', properties: { nodes: { type: 'number' }, conflicts: { type: 'number' } } },
    taskClass: 'do', requiresApproval: false, scopes: [], method: 'POST',
  },
  {
    id: 'memory.adjudicate',
    name: 'Truth review decision',
    description: 'Operator resolves a conflicted node (declarative approval UI).',
    input: { type: 'object', required: ['nodeId', 'verdict'], properties: { nodeId: { type: 'string' }, verdict: { enum: ['verified', 'probable', 'quarantined'] } } },
    output: { type: 'object' },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST',
  },

  // ---- runs & routing (§7) ----
  {
    id: 'runs.execute',
    name: 'Execute capability run',
    description: 'Create + run a capability with router-selected model; logs tokens/cost/rung.',
    input: { type: 'object', required: ['capability'], properties: { capability: { type: 'string' }, input: { type: 'object' } } },
    output: { type: 'object', properties: { runId: { type: 'string' }, status: { type: 'string' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['runs:write'], method: 'POST',
  },
  {
    id: 'playbooks.author',
    name: 'Author playbook (departing genius)',
    description: 'Budgeted frontier session whose deliverable is a versioned playbook. Always logged as think-class spend.',
    input: { type: 'object', required: ['taskFamily'], properties: { taskFamily: { type: 'string' }, brief: { type: 'string' } } },
    output: { type: 'object', properties: { playbookId: { type: 'string' }, version: { type: 'number' } } },
    taskClass: 'think', requiresApproval: true, scopes: [], method: 'POST',
  },

  // ---- factory (§5) ----
  {
    id: 'factory.build_site',
    name: 'Build wedge site',
    description: 'GBP/FB profile → facts → declarative descriptor → template render → preview deploy.',
    input: { type: 'object', required: ['profileUrl'], properties: { profileUrl: { type: 'string' }, template: { type: 'string' }, stylePack: { type: 'string' } } },
    output: { type: 'object', properties: { siteId: { type: 'string' }, previewUrl: { type: 'string' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['factory:write'], method: 'POST',
  },
  {
    id: 'factory.deploy_site',
    name: 'Deploy site live',
    description: 'Promote a demo site to live hosting. Deploys are governed.',
    input: { type: 'object', required: ['siteId'], properties: { siteId: { type: 'string' }, domain: { type: 'string' } } },
    output: { type: 'object', properties: { deployUrl: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST',
  },
  {
    id: 'leads.find',
    name: 'Find leads',
    description: 'Industry + location + criteria → scored lead table (active GBP, no website).',
    input: { type: 'object', required: ['industry', 'location'], properties: { industry: { type: 'string' }, location: { type: 'string' }, limit: { type: 'number' } } },
    output: { type: 'object', properties: { leads: { type: 'array' } } },
    taskClass: 'do', requiresApproval: false, scopes: ['leads:write'], method: 'POST',
  },
  {
    id: 'outreach.send',
    name: 'Send outreach message',
    description: 'One outreach touch (email/SMS/WhatsApp draft). ALWAYS approval-gated; daily cap enforced.',
    input: { type: 'object', required: ['leadId', 'channel', 'body'], properties: { leadId: { type: 'string' }, channel: { type: 'string' }, body: { type: 'string' } } },
    output: { type: 'object', properties: { approvalId: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: true, scopes: [], method: 'POST',
  },
  {
    id: 'events.site',
    name: 'Site event webhook',
    description: 'Deployed sites post form/chat/call events here → conversation + qualification workflow.',
    input: { type: 'object', required: ['siteId', 'channel', 'payload'], properties: { siteId: { type: 'string' }, channel: { type: 'string' }, payload: { type: 'object' } } },
    output: { type: 'object', properties: { conversationId: { type: 'string' } } },
    taskClass: 'quick', requiresApproval: false, scopes: ['events:write'], method: 'POST',
  },

  // ---- governance & ops ----
  {
    id: 'approvals.list',
    name: 'List pending approvals',
    description: 'Pending approval queue for the declarative approval UI.',
    input: { type: 'object' },
    output: { type: 'object', properties: { approvals: { type: 'array' } } },
    taskClass: 'quick', requiresApproval: false, scopes: [], method: 'GET',
  },
  {
    id: 'approvals.decide',
    name: 'Decide approval',
    description: 'Operator-only: approve/reject/defer with notes. Executes held action on approve.',
    input: { type: 'object', required: ['approvalId', 'decision'], properties: { approvalId: { type: 'string' }, decision: { enum: ['approved', 'rejected'] }, notes: { type: 'string' } } },
    output: { type: 'object' },
    taskClass: 'quick', requiresApproval: false, scopes: [], method: 'POST', // operator-only enforced by RLS + route guard
  },
  {
    id: 'status.mission_control',
    name: 'Mission Control status',
    description: 'Home cards: model-chain health, memory freshness, cache-hit rate, $ saved, live runs, pending approvals.',
    input: { type: 'object' },
    output: { type: 'object' },
    taskClass: 'quick', requiresApproval: false, scopes: [], method: 'GET',
  },
  {
    id: 'bench.run',
    name: 'Run model bench',
    description: 'Scheduled: score models on eval task families; results feed the router.',
    input: { type: 'object', properties: { taskFamily: { type: 'string' } } },
    output: { type: 'object', properties: { results: { type: 'array' } } },
    taskClass: 'do', requiresApproval: false, scopes: [], method: 'POST',
  },
];

/** Codegen contract (implemented in Codex lane, P1):
 *  - route path = '/v1/' + id.replace('.', '/')   e.g. POST /v1/memory/answer
 *  - every handler wraps: auth → scope check → input validation → audit_log insert → execute → output validation
 *  - requiresApproval capabilities insert approvals row + return {approvalId, status:'review'} instead of executing
 *  - GET handlers must be side-effect-free (enforced by review, asserted in tests)
 */
