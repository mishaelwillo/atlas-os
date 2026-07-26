import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  it('checks out the exact trusted event head with complete Git history', () => {
    const steps = loadBuildSteps();
    const checkout = steps.find((step) => step.uses === 'actions/checkout@v4');

    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(checkout?.with?.ref).toBe(
      "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
    );
  });

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

  it('requires the generated capability catalog to remain tracked', () => {
    const steps = loadBuildSteps();
    const catalog = steps.find(
      (step) => step.name === 'Verify capability catalog',
    );

    expect(catalog?.run).toContain(
      'git ls-files --error-unmatch docs/control/generated/capability-catalog.md',
    );
    expect(catalog?.run).toContain(
      'git diff --exit-code -- docs/control/generated/capability-catalog.md',
    );
  });

  it('fails the CI catalog contract when a deleted tracked file is regenerated untracked', () => {
    const directory = mkdtempSync(join(tmpdir(), 'atlas-ci-catalog-'));
    const catalogPath = join(
      directory,
      'docs',
      'control',
      'generated',
      'capability-catalog.md',
    );
    mkdirSync(dirname(catalogPath), { recursive: true });
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    execFileSync('git', ['config', 'user.name', 'Atlas Test'], {
      cwd: directory,
    });
    execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], {
      cwd: directory,
    });
    writeFileSync(catalogPath, 'tracked\n');
    execFileSync('git', ['add', '.'], { cwd: directory });
    execFileSync('git', ['commit', '--quiet', '-m', 'track catalog'], {
      cwd: directory,
    });
    rmSync(catalogPath);
    execFileSync('git', ['add', '-u'], { cwd: directory });
    execFileSync('git', ['commit', '--quiet', '-m', 'delete catalog'], {
      cwd: directory,
    });

    writeFileSync(catalogPath, 'regenerated but untracked\n');

    const ordinaryDiff = spawnSync(
      'git',
      [
        'diff',
        '--exit-code',
        '--',
        'docs/control/generated/capability-catalog.md',
      ],
      { cwd: directory },
    );
    const trackedAssertion = spawnSync(
      'git',
      [
        'ls-files',
        '--error-unmatch',
        'docs/control/generated/capability-catalog.md',
      ],
      { cwd: directory },
    );

    expect(ordinaryDiff.status).toBe(0);
    expect(trackedAssertion.status).not.toBe(0);
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
