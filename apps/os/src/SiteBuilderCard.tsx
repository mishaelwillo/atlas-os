/**
 * Site builder (docs/specs/p2/website-factory.md).
 *
 * Every displayed fact needs a source URL or an explicit owner-provided marker.
 * The form shows that per row rather than hiding it: an unsourced fact is not
 * rejected here — the API records it as a blocked gap and says which — but the
 * operator should see the requirement while entering, not discover it after.
 *
 * Field names are chosen, not typed. renderSection only emits fields the
 * template declares, so a free-text field box can only produce facts that are
 * stored and never displayed — a silent no-op the operator cannot see.
 */
import React, { useCallback, useEffect, useState } from 'react';
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

/** Shown as placeholders so the expected shape of each value is obvious. */
const EXAMPLES: Record<string, string> = {
  businessName: 'Acme Plumbing',
  phone: '(555) 010-0199',
  hours: 'Mon–Fri 8am–6pm',
  email: 'hello@acme.example',
  address: '12 Main St, Springfield',
  tagline: 'Same-day repairs, fixed pricing',
  services: 'Drain cleaning, water heaters',
  serviceArea: 'Springfield and surrounding areas',
};

function exampleFor(field: string): string {
  return EXAMPLES[field] ?? 'value shown on the page';
}

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
  const [facts, setFacts] = useState<FactRow[]>([{ ...BLANK_FACT }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const chosen = templates.find((t) => t.id === template) ?? null;

  // Arrive with one row per required field. Filling in known blanks beats
  // making the operator discover the field names and add the rows by hand.
  useEffect(() => {
    const required = templates.find((t) => t.id === template)?.requires ?? [];
    setFacts((rows) => {
      const kept = rows.filter((r) => r.value.trim() !== '');
      const have = new Set(kept.map((r) => r.field));
      const seeded = required
        .filter((f) => !have.has(f))
        .map((f) => ({ ...BLANK_FACT, field: f }));
      const next = [...kept, ...seeded];
      return next.length > 0 ? next : [{ ...BLANK_FACT }];
    });
  }, [template, templates]);

  // A field with no value is not sent, so it is not supplied — matching what
  // the build request will actually carry.
  const supplied = new Set(
    facts.filter((f) => f.field.trim() !== '' && f.value.trim() !== '').map((f) => f.field.trim()),
  );
  const missing = (chosen?.requires ?? []).filter((r) => !supplied.has(r));
  const unsourced = facts.filter(
    (f) =>
      f.field.trim() !== '' &&
      f.value.trim() !== '' &&
      !f.ownerProvided &&
      f.sourceUrl.trim() === '',
  );

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

  const fieldChoices = chosen ? [...chosen.requires, ...chosen.optional] : [];

  return (
    <div className={styles.card} data-testid="card-site-builder">
      <h3>Build a site</h3>
      <p className={styles.when}>
        Every displayed fact needs a source. Unsourced facts are recorded as gaps and
        never rendered.
      </p>

      <label className={styles.field}>
        <span>Profile URL — where you found this business</span>
        <input
          data-testid="profile-url"
          type="text"
          placeholder="https://maps.google.com/?cid=..."
          value={profileUrl}
          onChange={(e) => setProfileUrl(e.target.value)}
        />
        <span className={styles.when}>
          Their Google Maps, Yelp, or existing site. Identifies the business; not shown
          on the page.
        </span>
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

      <div className={styles.factList}>
        {facts.map((f, i) => (
          <div className={styles.factRow} key={i}>
            <div className={styles.factHead}>
              <span className={styles.factNum}>Fact {i + 1}</span>
              {facts.length > 1 && (
                <button
                  type="button"
                  className={styles.linkButton}
                  aria-label={`remove fact ${i + 1}`}
                  onClick={() => setFacts((rows) => rows.filter((_, j) => j !== i))}
                >
                  remove
                </button>
              )}
            </div>

            <label className={styles.field}>
              <span>Which field</span>
              {chosen ? (
                <select
                  aria-label={`fact ${i + 1} field`}
                  value={f.field}
                  onChange={(e) => update(i, { field: e.target.value })}
                >
                  <option value="">choose a field…</option>
                  {fieldChoices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                      {chosen.requires.includes(name) ? ' (required)' : ' (optional)'}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={`fact ${i + 1} field`}
                  type="text"
                  placeholder="businessName"
                  value={f.field}
                  onChange={(e) => update(i, { field: e.target.value })}
                />
              )}
            </label>

            <label className={styles.field}>
              <span>What it says on the page</span>
              <input
                aria-label={`fact ${i + 1} value`}
                type="text"
                placeholder={exampleFor(f.field)}
                value={f.value}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            </label>

            {f.ownerProvided ? (
              <p className={styles.when}>
                Owner-provided — attributed to the business owner, no public source.
              </p>
            ) : (
              <label className={styles.field}>
                <span>Source URL — the page you read this on</span>
                <input
                  aria-label={`fact ${i + 1} source`}
                  type="text"
                  placeholder="https://maps.google.com/?cid=..."
                  value={f.sourceUrl}
                  onChange={(e) => update(i, { sourceUrl: e.target.value })}
                />
              </label>
            )}

            <label className={styles.checkLine}>
              <input
                type="checkbox"
                aria-label={`fact ${i + 1} owner provided`}
                checked={f.ownerProvided}
                onChange={(e) => update(i, { ownerProvided: e.target.checked })}
              />
              <span>The owner told us this (no public source)</span>
            </label>
          </div>
        ))}
      </div>

      {chosen && missing.length > 0 && (
        <p className={styles.error} data-testid="missing-facts">
          still needed: {missing.join(', ')}
        </p>
      )}
      {unsourced.length > 0 && (
        <p className={styles.error} data-testid="unsourced-facts">
          no source yet: {unsourced.map((f) => f.field).join(', ')} — these will be
          recorded as gaps, not rendered.
        </p>
      )}

      <div className={styles.buttonRow}>
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
      </div>

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
