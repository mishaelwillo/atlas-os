import React from 'react';
import styles from './MissionControl.module.css';

/**
 * The build QA verdict, as the API reports it.
 *
 * A failing check is not advice: the publish gate refuses the same build, so
 * this is the operator's only view of why an approval will be refused.
 */
export interface QaSummary {
  passed: boolean;
  checked: number;
  failures: Array<{ id: string; category: string; detail: string }>;
  advisories: Array<{ id: string; category: string; detail: string }>;
}

export function QaVerdict({ qa }: { qa: QaSummary | null }): React.ReactElement | null {
  if (!qa) return null;
  return (
    <div data-testid="qa-verdict">
      <p className={qa.passed ? styles.when : styles.error}>
        {qa.passed
          ? `QA passed — ${qa.checked} checks`
          : `QA failed — this build cannot be approved for publish`}
      </p>
      {qa.failures.length > 0 && (
        <ul className={styles.error} data-testid="qa-failures">
          {qa.failures.map((f) => (
            <li key={f.id}>
              <code>{f.id}</code> — {f.detail}
            </li>
          ))}
        </ul>
      )}
      {qa.advisories.length > 0 && (
        <ul className={styles.when} data-testid="qa-advisories">
          {qa.advisories.map((a) => (
            <li key={a.id}>
              <code>{a.id}</code> — {a.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
