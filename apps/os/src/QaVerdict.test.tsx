/**
 * QA verdict (docs/specs/p2/website-factory.md).
 *
 * The publish gate refuses exactly the checks listed here, so this is the
 * operator's only view of why an approval will be refused. A failing build
 * must say so plainly rather than reporting a count that looks like progress.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QaVerdict, type QaSummary } from './QaVerdict.js';

const passing: QaSummary = { passed: true, checked: 28, failures: [], advisories: [] };

const failing: QaSummary = {
  passed: false,
  checked: 28,
  failures: [
    { id: 'link.scheme', category: 'link', detail: 'disallowed link schemes: http://maps.example/acme' },
  ],
  advisories: [],
};

describe('QaVerdict', () => {
  it('renders nothing when no report was returned', () => {
    const { container } = render(<QaVerdict qa={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports how many checks a passing build cleared', () => {
    render(<QaVerdict qa={passing} />);
    expect(screen.getByTestId('qa-verdict')).toHaveTextContent('QA passed — 28 checks');
    expect(screen.queryByTestId('qa-failures')).toBeNull();
  });

  /** The consequence is named, not just the count. */
  it('says a failing build cannot be approved, and which check failed', () => {
    render(<QaVerdict qa={failing} />);
    expect(screen.getByTestId('qa-verdict')).toHaveTextContent(/cannot be approved for publish/i);
    expect(screen.getByTestId('qa-failures')).toHaveTextContent('link.scheme');
    expect(screen.getByTestId('qa-failures')).toHaveTextContent('http://maps.example/acme');
  });

  /** An advisory is shown without claiming the build failed. */
  it('separates advisories from failures', () => {
    render(
      <QaVerdict
        qa={{
          ...passing,
          advisories: [
            { id: 'performance.page-weight-budget', category: 'performance', detail: 'is 61000' },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('qa-verdict')).toHaveTextContent('QA passed');
    expect(screen.getByTestId('qa-advisories')).toHaveTextContent('performance.page-weight-budget');
    expect(screen.queryByTestId('qa-failures')).toBeNull();
  });
});
