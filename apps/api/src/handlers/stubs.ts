/**
 * Typed TODO stubs (brief §2: "stub with typed TODO otherwise").
 * Each throws a 501 CapabilityError so the route pipeline (auth, validation,
 * audit) still runs and the contract surface is complete.
 * NOTE: approval-gated capabilities (memory.adjudicate, playbooks.author,
 * factory.deploy_site, outreach.send) never reach a handler — the pipeline
 * inserts an approvals row first. Their post-approval behavior lives in
 * dispatch.ts. Stubs below exist for completeness/dispatch wiring.
 */
import { CapabilityError, type CapabilityHandler } from '../pipeline.js';

const todo = (id: string, note: string): CapabilityHandler => {
  return async () => {
    throw new CapabilityError(501, `${id}: not implemented in P1 — ${note}`);
  };
};

export const memoryAdjudicate = todo('memory.adjudicate', 'executes via dispatch.ts after operator approval');
export const playbooksAuthor = todo('playbooks.author', 'frontier authoring session lands in P2');
export const factoryBuildSite = todo('factory.build_site', 'Website Factory pipeline lands in P2');
export const factoryDeploySite = todo('factory.deploy_site', 'deploy fires via dispatch.ts after approval');
export const leadsFind = todo('leads.find', 'lead scoring pipeline lands in P2');
export const outreachSend = todo('outreach.send', 'send fires via dispatch.ts after approval (log-only stub)');
export const benchRun = todo('bench.run', 'model bench harness lands in P2');
