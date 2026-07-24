import { redactSecrets } from './observed-state.js';

export interface HandoffInput {
  id: string;
  actor: string;
  objective: string;
  workItem: string;
  nextAction: string;
  definitionOfDone: string;
}

export interface HandoffObservedState {
  updatedAt: string;
  branch: string;
  baseCommit: string;
  headCommit: string;
  reviewStatus: string;
  filesChanged: string[];
  testEvidence: string[];
  databaseActions: string[];
  hostingActions: string[];
  externalSideEffects: string[];
  blockers: string[];
}

const HANDOFF_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORK_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const COMMIT = /^(?:[0-9a-f]{7,64}|unknown)$/;
const SAFE_ACTOR = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;

function assertSingleLine(name: string, value: string, maxLength = 500): void {
  if (!value.trim()) throw new Error(`${name} is required`);
  if (/[\r\n]/.test(value)) throw new Error(`${name} must be a single line`);
  if (value.length > maxLength) throw new Error(`${name} must be at most ${maxLength} characters`);
  if (value.includes('`')) throw new Error(`${name} contains unsafe Markdown characters`);
  if (redactSecrets(value) !== value) throw new Error(`${name} contains secret-like content`);
}

export function validateHandoffInput(input: HandoffInput): void {
  if (!HANDOFF_ID.test(input.id)) {
    throw new Error('--id must be a stable lowercase kebab-case identifier');
  }
  if (!SAFE_ACTOR.test(input.actor)) throw new Error('--actor contains unsafe characters');
  if (!WORK_ITEM_ID.test(input.workItem)) {
    throw new Error('--work-item contains unsafe characters');
  }
  assertSingleLine('--objective', input.objective);
  assertSingleLine('--next', input.nextAction);
  assertSingleLine('--definition-of-done', input.definitionOfDone);
}

function validateObservedState(observed: HandoffObservedState): void {
  if (!Number.isFinite(Date.parse(observed.updatedAt))) {
    throw new Error('updatedAt must be a valid timestamp');
  }
  assertSingleLine('branch', observed.branch, 200);
  if (!COMMIT.test(observed.baseCommit) || !COMMIT.test(observed.headCommit)) {
    throw new Error('base and head commits must be hexadecimal Git SHAs or unknown');
  }
  assertSingleLine('review status', observed.reviewStatus, 200);
  for (const [name, values] of Object.entries({
    'files changed': observed.filesChanged,
    'test evidence': observed.testEvidence,
    'database actions': observed.databaseActions,
    'hosting actions': observed.hostingActions,
    'external side effects': observed.externalSideEffects,
    blockers: observed.blockers,
  })) {
    for (const value of values) assertSingleLine(name, value, 1_000);
  }
}

function renderList(values: string[], fallback: string): string {
  return (values.length > 0 ? values : [fallback]).map((value) => `- ${value}`).join('\n');
}

function renderCodeList(values: string[]): string {
  return values.length > 0
    ? values.map((value) => `- \`${value}\``).join('\n')
    : '- None.';
}

export function createHandoff(
  input: HandoffInput,
  observedState: HandoffObservedState,
): string {
  validateHandoffInput(input);
  validateObservedState(observedState);

  return `# Current Handoff

**Handoff ID:** \`${input.id}\`
**Status:** active
**Updated:** ${observedState.updatedAt}
**Actor:** ${input.actor}
**Objective:** ${input.objective}

## Active work

- Work item: \`${input.workItem}\`
- Branch: \`${observedState.branch}\`
- Base commit: \`${observedState.baseCommit}\`
- Head commit: \`${observedState.headCommit}\`
- Review status: ${observedState.reviewStatus}

## Files changed

${renderCodeList(observedState.filesChanged)}

## Verification evidence

${renderList(observedState.testEvidence, 'No test evidence recorded yet.')}

## Database actions

${renderList(observedState.databaseActions, 'None.')}

## Hosting actions

${renderList(observedState.hostingActions, 'None.')}

## External side effects

${renderList(observedState.externalSideEffects, 'None.')}

## Blockers

${renderList(observedState.blockers, 'None.')}

## Next exact action

${input.nextAction}

## Definition of done

${input.definitionOfDone}
`;
}

export function isSafeHandoffId(value: string): boolean {
  return HANDOFF_ID.test(value);
}

export function isSafeWorkItemId(value: string): boolean {
  return WORK_ITEM_ID.test(value);
}
