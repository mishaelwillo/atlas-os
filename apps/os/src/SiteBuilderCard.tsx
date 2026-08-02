/**
 * Site builder (docs/specs/p2/website-factory.md).
 *
 * Every displayed fact needs a source URL or an explicit owner-provided marker.
 * The form shows that per row rather than hiding it: an unsourced fact is not
 * rejected here — the API records it as a blocked gap and says which — but the
 * operator should see the requirement while entering, not discover it after.
 */
import React, { useCallback, useState } from 'react';
import type { AtlasGeneratedClient } from '@atlas/client';
import styles from './MissionControl.module.css';

export interface TemplateOption {
  id: string;
  vertical: string;
  regions: string[];
  requires: string[];
  optional: string[];
}

interface FactRow {
  field: string;
  value: string;
  sourceUrl: string;
  ownerProvided: boolean;
}

const BLANK_FACT: FactRow = { field: '', value: '', sourceUrl: '', ownerProvided: false };

export interface SiteBuilderCardProps {
  templates: TemplateOption[];
  client: AtlasGeneratedClient;
  hasSpace: boolean;
  onBuilt: () => void;
}

export function SiteBuilderCard({
  templates,
  client,
  hasSpace,
  onBuilt,
}: SiteBuilderCardProps): React.ReactElement {
  const [profileUrl, setProfileUrl] = useState('');
  const [template, setTemplate] = useState(templates[0]?.id ?? '');
  const [facts, setFacts] = useState<FactRow[]>([{ ...BLANK_FACT, field: 'businessName' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const chosen = templates.find((t) => t.id === template) ?? null;
  const supplied = new Set(facts.filter((f) => f.field.trim() !== '').map((f) => f.field.trim()));
  const missing = (chosen?.requires ?? []).filter((r) => !supplied.has(r));

  const update = useCallback((index: number, patch: Partial<FactRow>) => {
    setFacts((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  const build = useCallback(async () => {
    setError(null);
    setResult(null);
    if (!hasSpace) {
      setError('Select a Space before building a site.');
      return;
    }
    if (profileUrl.trim() === '') {
      setError('A profile URL is required.');
      return;
    }
    setBusy(true);
    try {
      // Owner-provided and sourced are mutually exclusive on the wire: sending
      // both would let a blank source ride along with the owner marker.
      const payload = facts
        .filter((f) => f.field.trim() !== '' && f.value.trim() !== '')
        .map((f) => ({
          field: f.field.trim(),
          value: f.value.trim(),
          ...(f.ownerProvided ? { ownerProvided: true } : { sourceUrl: f.sourceUrl.trim() }),
        }));
      const res = (await client.factoryBuildSite({
        profileUrl: profileUrl.trim(),
        template: template === '' ? undefined : template,
        facts: payload,
      })) as unknown as Record<string, unknown>;
      setResult(res);
      onBuilt();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [client, hasSpace, profileUrl, template, facts, onBuilt]);

  const blocked = Array.isArray(result?.blocked)
    ? (result.blocked as Array<{ field: string; reason: string }>)
    : [];

  return (
    <div className={styles.card} data-testid="card-site-builder">
      <h3>Build a site</h3>
      <p className={styles.when}>
        Every displayed fact needs a source. Unsourced facts are recorded as gaps and
        never rendered.
      </p>

      <label className={styles.field}>
        <span>Profile URL</span>
        <input
          data-testid="profile-url"
          type="text"
          placeholder="https://maps.google.com/..."
          value={profileUrl}
          onChange={(e) => setProfileUrl(e.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span>Template</span>
        <select
          data-testid="template-select"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
        >
          <option value="">no template (descriptor only)</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} ({t.vertical})
            </option>
          ))}
        </select>
      </label>

      {chosen && (
        <p className={styles.when} data-testid="template-requirements">
          requires: {chosen.requires.join(', ')}
          {chosen.optional.length > 0 ? ` · optional: ${chosen.optional.join(', ')}` : ''}
        </p>
      )}
      {chosen && missing.length > 0 && (
        <p className={styles.error} data-testid="missing-facts">
          still needed: {missing.join(', ')}
        </p>
      )}

      <table className={styles.table}>
        <tbody>
          {facts.map((f, i) => (
            <tr key={i}>
              <td>
                <input
                  aria-label={`fact ${i + 1} field`}
                  type="text"
                  placeholder="field"
                  value={f.field}
                  onChange={(e) => update(i, { field: e.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`fact ${i + 1} value`}
                  type="text"
                  placeholder="value"
                  value={f.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              </td>
              <td>
                {f.ownerProvided ? (
                  <span className={styles.when}>owner-provided</span>
                ) : (
                  <input
                    aria-label={`fact ${i + 1} source`}
                    type="text"
                    placeholder="source URL"
                    value={f.sourceUrl}
                    onChange={(e) => update(i, { sourceUrl: e.target.value })}
                  />
                )}
              </td>
              <td>
                <label className={styles.when}>
                  <input
                    type="checkbox"
                    aria-label={`fact ${i + 1} owner provided`}
                    checked={f.ownerProvided}
                    onChange={(e) => update(i, { ownerProvided: e.target.checked })}
                  />
                  {' owner'}
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        type="button"
        data-testid="add-fact"
        onClick={() => setFacts((r) => [...r, { ...BLANK_FACT }])}
      >
        Add fact
      </button>
      <button type="button" data-testid="build-site" disabled={busy} onClick={() => void build()}>
        {busy ? 'Building…' : 'Build site'}
      </button>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className={styles.when} data-testid="build-result">
          <p>
            status <code>{String(result.status)}</code>
            {result.created === false ? ' — nothing was created' : ''}
          </p>
          {typeof result.buildHash === 'string' && (
            <p>
              build <code>{result.buildHash.slice(0, 12)}</code>
            </p>
          )}
          {blocked.length > 0 && (
            <p className={styles.error} data-testid="build-blocked">
              blocked: {blocked.map((b) => `${b.field} (${b.reason})`).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
