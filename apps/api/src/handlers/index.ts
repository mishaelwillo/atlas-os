/** Handler map — one entry per registry capability (completeness asserted in tests). */
import type { CapabilityHandler } from '../pipeline.js';
import { approvalsDecide, approvalsList } from './approvals.js';
import { eventsSite } from './events.js';
import { memoryAnswer, memoryDistill, memoryIngest } from './memory.js';
import { runsExecute } from './runs.js';
import { factoryBuildSite, factoryPreview } from './factory.js';
import {
  demosAdvance,
  demosEnqueue,
  prospectingQualify,
  prospectingWorkspace,
} from './prospecting.js';
import { dealsDecide, hostingState, offersPublish } from './offers.js';
import { automationSequence, sequenceAdvance, sequenceState } from './sequence.js';
import { statusMissionControl } from './status.js';
import {
  benchRun,
  factoryDeploySite,
  leadsFind,
  memoryAdjudicate,
  outreachSend,
  playbooksAuthor,
} from './stubs.js';

export const handlers: Record<string, CapabilityHandler> = {
  // implemented (brief §2 "Implement now")
  'status.mission_control': statusMissionControl,
  'approvals.list': approvalsList,
  'approvals.decide': approvalsDecide,
  'memory.ingest': memoryIngest,
  'runs.execute': runsExecute,
  'events.site': eventsSite,
  'prospecting.qualify': prospectingQualify,
  'prospecting.workspace': prospectingWorkspace,
  'demos.enqueue': demosEnqueue,
  'demos.advance': demosAdvance,
  'automation.sequence': automationSequence,
  'sequence.advance': sequenceAdvance,
  'sequence.state': sequenceState,
  'offers.publish': offersPublish,
  'deals.decide': dealsDecide,
  'hosting.state': hostingState,
  // typed TODO stubs
  'memory.answer': memoryAnswer,
  'memory.distill': memoryDistill,
  'memory.adjudicate': memoryAdjudicate,
  'playbooks.author': playbooksAuthor,
  'factory.build_site': factoryBuildSite,
  'factory.preview': factoryPreview,
  'factory.deploy_site': factoryDeploySite,
  'leads.find': leadsFind,
  'outreach.send': outreachSend,
  'bench.run': benchRun,
};
