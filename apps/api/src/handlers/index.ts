/** Handler map — one entry per registry capability (completeness asserted in tests). */
import type { CapabilityHandler } from '../pipeline.js';
import { approvalsDecide, approvalsList } from './approvals.js';
import { eventsSite } from './events.js';
import { memoryAnswer, memoryDistill, memoryIngest } from './memory.js';
import { runsExecute } from './runs.js';
import { statusMissionControl } from './status.js';
import {
  benchRun,
  factoryBuildSite,
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
  // typed TODO stubs
  'memory.answer': memoryAnswer,
  'memory.distill': memoryDistill,
  'memory.adjudicate': memoryAdjudicate,
  'playbooks.author': playbooksAuthor,
  'factory.build_site': factoryBuildSite,
  'factory.deploy_site': factoryDeploySite,
  'leads.find': leadsFind,
  'outreach.send': outreachSend,
  'bench.run': benchRun,
};
