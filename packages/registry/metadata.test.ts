import { describe, expect, expectTypeOf, it } from 'vitest';
import { registry, type CapabilityId } from './registry.js';
import {
  capabilityMetadata,
  type CapabilityMetadata,
  type CapabilityStage,
  type ImplementationMode,
  type MonetizationRole,
} from './metadata.js';

describe('capability lifecycle metadata', () => {
  it('covers every executable capability and no unregistered capability', () => {
    expect(Object.keys(capabilityMetadata).sort()).toEqual(
      registry.map((capability) => capability.id).sort(),
    );
  });

  it('preserves literal capability IDs', () => {
    expectTypeOf<CapabilityId>().toEqualTypeOf<
      | 'memory.answer'
      | 'memory.ingest'
      | 'memory.distill'
      | 'memory.adjudicate'
      | 'runs.execute'
      | 'playbooks.author'
      | 'factory.build_site'
      | 'factory.deploy_site'
      | 'leads.find'
      | 'outreach.send'
      | 'events.site'
      | 'approvals.list'
      | 'approvals.decide'
      | 'status.mission_control'
      | 'bench.run'
    >();
  });

  it('assigns the website factory to P2B', () => {
    expect(capabilityMetadata['factory.build_site'].phase).toBe('P2B');
  });

  it('keeps outbound outreach in shadow mode', () => {
    expect(capabilityMetadata['outreach.send'].autonomy).toBe('shadow');
  });

  it('keeps live deployment in shadow mode', () => {
    expect(capabilityMetadata['factory.deploy_site'].autonomy).toBe('shadow');
  });

  it('never grants full autonomy to outbound or deployment capabilities', () => {
    const governedIds: CapabilityId[] = [
      'outreach.send',
      'factory.deploy_site',
    ];

    for (const id of governedIds) {
      expect(capabilityMetadata[id].autonomy).not.toBe('full-auto');
    }
  });

  it('exports the lifecycle dimensions as literal unions', () => {
    expectTypeOf<CapabilityStage>().toEqualTypeOf<
      CapabilityMetadata['stage']
    >();
    expectTypeOf<ImplementationMode>().toEqualTypeOf<
      CapabilityMetadata['implementation']
    >();
    expectTypeOf<MonetizationRole>().toEqualTypeOf<
      CapabilityMetadata['monetization']
    >();
  });
});
