import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
};

type Workflow = {
  jobs?: Record<string, { steps?: WorkflowStep[] }>;
};

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');

function loadBuildSteps(): WorkflowStep[] {
  const workflow = parse(readFileSync(workflowPath, 'utf8')) as Workflow;
  return workflow.jobs?.['build-and-test']?.steps ?? [];
}

describe('Atlas CI continuity contract', () => {
  it('uses the repository pnpm version and a frozen lockfile', () => {
    const steps = loadBuildSteps();
    const pnpm = steps.find((step) => step.uses?.startsWith('pnpm/action-setup@'));
    const install = steps.find((step) => step.name === 'Install Dependencies');

    expect(pnpm?.with?.version).toBe('11.15.1');
    expect(install?.run).toBe('pnpm install --frozen-lockfile');
  });

  it('runs static control verification after install and before build', () => {
    const steps = loadBuildSteps();
    const installIndex = steps.findIndex(
      (step) => step.name === 'Install Dependencies',
    );
    const controlIndex = steps.findIndex(
      (step) =>
        step.name === 'Verify Atlas control plane' &&
        step.run === 'pnpm control:verify',
    );
    const buildIndex = steps.findIndex((step) => step.name === 'Build Workspace');

    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(controlIndex).toBeGreaterThan(installIndex);
    expect(buildIndex).toBeGreaterThan(controlIndex);
  });

  it('checks generated API and client artifacts after build', () => {
    const steps = loadBuildSteps();
    const buildIndex = steps.findIndex((step) => step.name === 'Build Workspace');
    const generatedIndex = steps.findIndex(
      (step) =>
        step.name === 'Verify generated files are committed' &&
        step.run ===
          'git diff --exit-code -- apps/api/src/routes.gen.ts packages/client/src/client.gen.ts',
    );

    expect(generatedIndex).toBeGreaterThan(buildIndex);
  });

  it('does not collect live state or provide live-control credentials', () => {
    const steps = loadBuildSteps();
    const serialized = JSON.stringify(steps);

    expect(serialized).not.toContain('control:status');
    expect(serialized).not.toContain('ATLAS_CONTROL_LIVE');
    expect(serialized).not.toContain('DATABASE_URL');
    expect(serialized).not.toContain('SUPABASE');
    expect(serialized).not.toContain('RAILWAY');
  });
});
