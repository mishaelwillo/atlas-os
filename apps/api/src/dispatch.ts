/**
 * Approval dispatchers — the ONLY place a held (requiresApproval) action
 * executes, and only from approvals.decide after an operator approves
 * (SECURITY.md inv. 1/3/4). Keyed by approvals.kind (= capability id).
 */
import { insertAudit, type ApprovalDispatcher } from './pipeline.js';
import type { Descriptor } from './factory/dossier.js';
import { renderSite } from './factory/render.js';
import { planPublish } from './factory/publish.js';
import { runQa } from './factory/qa.js';
import { classifyFingerprint } from './factory/fingerprint.js';
import { planTouchAdvance } from './revenue/sequence.js';
import { readActivationFacts } from './revenue/activation-read.js';
import { planCancellation, planHostingTransition } from './revenue/hosting-activation.js';
import { siteSlug } from './factory/hosting.js';

/**
 * Mark a sequence touch as sent.
 *
 * This is the ONLY place `scheduled → sent` is permitted: `planTouchAdvance`
 * refuses that move to everyone else, so a sequence cannot record an outbound
 * effect that no approved dispatch performed. It runs after the send, and a
 * touch that is not `scheduled` is left alone rather than dragged forward.
 *
 * A missing table means migration 0005 has not been applied; the dispatch
 * itself still stands, so that is reported rather than thrown.
 */
async function markTouchSent(
  ctx: Parameters<ApprovalDispatcher>[0],
  touchId: string,
): Promise<{ recorded: boolean; note?: string }> {
  try {
    const found = await ctx.q.query(
      `select t.touch_id, t.state, s.state as sequence_state
         from outreach_touches t
         join outreach_sequences s on s.sequence_id = t.sequence_id
        where t.touch_id = $1`,
      [touchId],
    );
    const row = found.rows[0];
    if (!row) return { recorded: false, note: 'touch not found' };

    const plan = planTouchAdvance({
      sequenceState: String(row.sequence_state),
      from: String(row.state),
      to: 'sent',
      approvalId: null,
      viaDispatcher: true,
    });
    if (!plan.ok) return { recorded: false, note: plan.message };

    await ctx.q.query(
      `update outreach_touches set state = 'sent', sent_at = now(), updated_at = now()
        where touch_id = $1`,
      [touchId],
    );
    await ctx.q.query(
      `update outreach_sequences set state = 'active', updated_at = now()
        where sequence_id = (select sequence_id from outreach_touches where touch_id = $1)`,
      [touchId],
    );
    return { recorded: true };
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '42P01') {
      return { recorded: false, note: 'migration 0005_outreach_sequences has not been applied' };
    }
    throw err;
  }
}

/**
 * outreach.send — LOG-ONLY sender stub (P1 acceptance: "dispatcher fires
 * (log-only sender stub)"). A real channel adapter lands in P2; even then the
 * outbound message row must carry approved_by (schema-enforced).
 *
 * When the approved input names a sequence touch, that touch is recorded as
 * sent here and nowhere else.
 */
const outreachSend: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  ctx.deps.log.info(
    { leadId: input.leadId, channel: input.channel, bodyPreview: String(input.body ?? '').slice(0, 120) },
    'OUTREACH DISPATCH (log-only stub) — message NOT actually sent',
  );

  const touchId = typeof input.touchId === 'string' ? input.touchId.trim() : '';
  const touch = touchId === '' ? null : await markTouchSent(ctx, touchId);

  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'outreach.dispatched', String(input.leadId ?? ''), {
    channel: input.channel,
    stub: true,
    touchId: touchId === '' ? null : touchId,
    touchRecorded: touch?.recorded ?? null,
  });
  return {
    executed: true,
    stub: true,
    note: 'log-only sender — no message left the system',
    touchRecorded: touch?.recorded ?? null,
    touchNote: touch?.note ?? null,
  };
};

/** memory.adjudicate — operator verdict applied to the conflicted node. */
const memoryAdjudicate: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  const res = await ctx.q.query(
    `update memory_nodes set truth_status = $2, updated_at = now() where node_id = $1`,
    [input.nodeId, input.verdict],
  );
  return { executed: true, updated: res.rowCount ?? 0 };
};

/**
 * factory.deploy_site — promote exactly the approved build.
 *
 * The descriptor is re-rendered here rather than trusting a hash recorded
 * earlier. Rendering is deterministic, so a mismatch means the descriptor
 * changed between approval and publish, which is precisely the case where
 * publishing would put something live that nobody approved.
 *
 * The build is handed to the hosting adapter before anything is recorded, and
 * the row then states what actually happened: 'live' with its address when the
 * provider accepted it, 'queued' with the reason when it did not. A record
 * written before the outcome is known would make the history claim something
 * is public that may never have been.
 */
const factoryDeploySite: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  const siteId = typeof input.siteId === 'string' ? input.siteId.trim() : '';
  if (siteId === '') {
    return { executed: false, note: 'factory.deploy_site: siteId is required' };
  }

  const found = await ctx.q.query(
    `select site_id, business_name, descriptor from sites where site_id = $1`,
    [siteId],
  );
  const row = found.rows[0];
  if (!row) return { executed: false, note: 'factory.deploy_site: site not found' };

  const render = renderSite(row.descriptor as Descriptor);
  const approvedBuildHash =
    typeof input.buildHash === 'string' && input.buildHash.trim() !== ''
      ? input.buildHash.trim()
      : render.rendered
        ? render.hash
        : '';

  const history = await ctx.q.query(
    `select deployment_id, version, build_hash, status
       from site_deployments where site_id = $1
      order by version desc limit 1`,
    [siteId],
  );
  const liveRow = await ctx.q.query(
    `select deployment_id, version, build_hash
       from site_deployments
      where site_id = $1 and status = 'live' and environment = 'production'
      limit 1`,
    [siteId],
  );
  const latestVersion = Number(history.rows[0]?.version ?? 0);
  const live = liveRow.rows[0]
    ? {
        deploymentId: String(liveRow.rows[0].deployment_id),
        version: Number(liveRow.rows[0].version),
        buildHash: String(liveRow.rows[0].build_hash),
      }
    : null;

  /*
   * QA runs on the bytes about to be promoted, not on a verdict recorded when
   * the approval was created. Checks are deterministic over the same build, so
   * this cannot disagree with what the operator saw unless the descriptor
   * changed — which is precisely when it must.
   */
  const descriptor = row.descriptor as Descriptor;
  const qa = render.rendered
    ? runQa({ html: render.html, descriptor, tokens: render.tokens })
    : null;

  const plan = planPublish({
    approvedBuildHash,
    currentBuildHash: render.rendered ? render.hash : null,
    renderIssues: render.rendered ? [] : render.issues,
    qaFailures: qa ? qa.blocking.map((c) => c.id) : [],
    latestVersion,
    live,
  });

  if (!plan.ok) {
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'factory.deploy_refused', siteId, {
      code: plan.code,
      qaFailures: plan.qaFailures ?? [],
    });
    return {
      executed: false,
      note: plan.message,
      code: plan.code,
      qaFailures: plan.qaFailures,
    };
  }

  /*
   * Attempt the publish first, then record the outcome. A failure is kept as a
   * queued row carrying the provider's reason rather than being discarded: the
   * operator approved this, so the attempt belongs in history either way.
   */
  const slug = siteSlug(String(row.business_name ?? ''), siteId);
  let published: { url: string; providerRef: string | null } | null = null;
  let publishError: string | null = null;
  try {
    published = await ctx.deps.hosting.publish({
      slug,
      html: render.rendered ? render.html : '',
      buildHash: plan.buildHash,
      version: plan.version,
    });
  } catch (err) {
    publishError = err instanceof Error ? err.message : String(err);
  }

  /*
   * Read the published address back before recording anything. `build_hash` is
   * what Atlas intended to publish; this is what a reader actually receives,
   * and the acceptance is about the second. A failure to read is recorded as
   * unreadable rather than assumed fine — a row carrying a verified-looking
   * fingerprint that nothing verified would be worse than no read-back at all.
   *
   * This never fails the publish. The site is serving; refusing to record that
   * because a read-back stumbled would be its own inaccuracy.
   */
  let fingerprint = null;
  if (published) {
    try {
      const read = await ctx.deps.readPublic(published.url);
      fingerprint = classifyFingerprint({ approved: plan.buildHash, read });
    } catch (err) {
      fingerprint = classifyFingerprint({
        approved: plan.buildHash,
        read: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const status = published ? 'live' : 'queued';
  const inserted = await ctx.q.query(
    `insert into site_deployments
       (space_id, site_id, version, environment, domain, build_hash, renderer_sha, status, approved_by, went_live_at,
        public_fingerprint, fingerprint_checked_at, fingerprint_matches)
     values ($1, $2, $3, 'production', $4, $5, $6, $7, $8, case when $7 = 'live' then now() else null end,
             $9, case when $9 is null then null else now() end, $10)
     returning deployment_id`,
    [
      ctx.spaceId,
      siteId,
      plan.version,
      published?.url ?? null,
      plan.buildHash,
      ctx.deps.buildInfo.gitSha,
      status,
      ctx.auth.actor,
      fingerprint?.observed ?? null,
      fingerprint === null ? null : fingerprint.matches,
    ],
  );
  const deploymentId = String(inserted.rows[0]?.deployment_id ?? '');

  // Exactly one live production deployment per site is enforced by a partial
  // unique index, so the previous one must step down as this one arrives.
  if (published && plan.supersedes) {
    await ctx.q.query(
      `update site_deployments set status = 'superseded', superseded_at = now()
        where deployment_id = $1 and status = 'live'`,
      [plan.supersedes],
    );
  }

  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, `factory.deploy_${status}`, deploymentId, {
    siteId,
    version: plan.version,
    buildHash: plan.buildHash,
    provider: ctx.deps.hosting.name,
    fingerprint: fingerprint?.verdict ?? null,
  });

  return {
    executed: true,
    deploymentId,
    version: plan.version,
    buildHash: plan.buildHash,
    supersedes: plan.supersedes,
    status,
    url: published?.url ?? null,
    providerRef: published?.providerRef ?? null,
    fingerprint: fingerprint?.verdict ?? null,
    publicFingerprint: fingerprint?.observed ?? undefined,
    note: published
      ? fingerprint?.matches === true
        ? `published to ${published.url}`
        : `published to ${published.url}, but ${fingerprint?.message ?? 'the address was not read back'}`
      : `build verified and recorded, but not serving: ${publishError ?? 'no hosting target is configured'}`,
  };
};

/** playbooks.author — stub: budgeted frontier session lands in P2. */
/**
 * Slug for the playbook series a task family belongs to. Versions of the same
 * family must collide on this value, which is what makes them a lineage
 * rather than unrelated rows.
 */
export function playbookSlug(taskFamily: string): string {
  return taskFamily
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * playbooks.author — persists an approved playbook as a new immutable version.
 *
 * The spec's budgeted frontier session is NOT run here: no model credential is
 * configured, so calling one would fail at runtime. Rather than write an empty
 * record and call it authored, this stores the operator's brief as the body and
 * refuses when there is nothing to store. Rows are only ever inserted; a later
 * version supersedes an earlier one by ordering, never by mutation.
 */
const playbooksAuthor: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  const taskFamily = typeof input.taskFamily === 'string' ? input.taskFamily.trim() : '';
  const brief = typeof input.brief === 'string' ? input.brief.trim() : '';

  if (taskFamily === '') {
    return { executed: false, note: 'playbooks.author: taskFamily is required' };
  }
  const slug = playbookSlug(taskFamily);
  if (slug === '') {
    return { executed: false, note: 'playbooks.author: taskFamily has no usable slug' };
  }
  if (brief === '') {
    // Nothing was authored, so nothing is recorded. An empty playbook would
    // read as an approved deliverable that does not exist.
    return {
      executed: false,
      note: 'playbooks.author: no brief supplied and no frontier session is configured, so there is nothing to author',
    };
  }

  // Version selection and insert are one statement so two concurrent approvals
  // cannot both read the same max; the (space_id, slug, version) unique index
  // is the backstop if they somehow do.
  const res = await ctx.q.query(
    `insert into playbooks (space_id, slug, version, task_family, body, authored_by)
     select $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5
       from playbooks
      where space_id is not distinct from $1 and slug = $2
     returning playbook_id, version`,
    [ctx.spaceId, slug, taskFamily, brief, ctx.auth.actor],
  );

  const row = res.rows[0];
  if (!row) {
    return { executed: false, note: 'playbooks.author: playbook was not persisted' };
  }

  const version = Number(row.version);
  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'playbooks.authored', String(row.playbook_id), {
    slug,
    version,
    taskFamily,
  });

  return {
    executed: true,
    playbookId: String(row.playbook_id),
    version,
    slug,
    supersedes: version > 1 ? version - 1 : null,
    frontierSession: false,
  };
};

/**
 * hosting.activate — grant a customer hosting, once and only once terms are
 * accepted and payment is recorded.
 *
 * The gate is re-decided here rather than trusted from the approval. An
 * approval says an operator was willing to activate; it does not say the deal
 * is still accepted, that the accepted offer is the one being activated, or
 * that a payment reference exists. All three are read fresh.
 *
 * Atlas never confirms the payment itself. `billing.manage` is deferred to P3,
 * so the reference is a fact an operator read off the provider's console.
 */
const hostingActivate: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  const leadId = typeof input.leadId === 'string' ? input.leadId.trim() : '';
  if (leadId === '') return { executed: false, note: 'hosting.activate: leadId is required' };

  const decided = await readActivationFacts(ctx.q, leadId);
  if ('note' in decided) return { executed: false, note: decided.note };

  const plan = planHostingTransition({
    from: decided.state,
    to: 'entitlement_active',
    dealState: decided.dealState,
    acceptedOfferVersion: decided.acceptedOfferVersion,
    entitlementOfferVersion: decided.entitlementOfferVersion,
    disclosuresComplete: decided.disclosuresComplete,
    paymentReference: decided.paymentReference,
  });

  if (!plan.ok) {
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'hosting.activate_refused', leadId, {
      code: plan.code,
    });
    return { executed: false, note: plan.message, code: plan.code };
  }

  await ctx.q.query(
    `update hosting_entitlements
        set state = 'entitlement_active', activated_at = now(), updated_at = now()
      where entitlement_id = $1`,
    [decided.entitlementId],
  );
  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'hosting.activated', decided.entitlementId, {
    leadId,
    offerVersion: decided.entitlementOfferVersion,
  });

  return {
    executed: true,
    entitlementId: decided.entitlementId,
    state: 'entitlement_active',
    offerVersion: decided.entitlementOfferVersion,
    note: 'hosting entitlement is active',
  };
};

/**
 * hosting.cancel — stop renewal without destroying anything.
 *
 * Cancellation deletes no history, no offer and no export: the specification
 * requires both to survive it, and the pilot needs the record of customers who
 * left as much as of those who stayed. A customer who paid for the period
 * keeps it — cancelling is not a refund, and taking a paid-for site down early
 * would be worse service than the thing being cancelled.
 */
const hostingCancel: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  const leadId = typeof input.leadId === 'string' ? input.leadId.trim() : '';
  if (leadId === '') return { executed: false, note: 'hosting.cancel: leadId is required' };
  const servesUntil = typeof input.servesUntil === 'string' ? input.servesUntil.trim() : null;

  const found = await ctx.q.query(
    `select entitlement_id, state from hosting_entitlements
      where lead_id = $1 order by created_at desc limit 1`,
    [leadId],
  );
  const row = found.rows[0];
  if (!row) return { executed: false, note: 'hosting.cancel: no entitlement for this lead' };

  const plan = planCancellation(String(row.state));
  if (!plan.ok) {
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'hosting.cancel_refused', leadId, {
      code: plan.code,
    });
    return { executed: false, note: plan.message, code: plan.code };
  }

  await ctx.q.query(
    `update hosting_entitlements
        set state = 'cancelled', renewal_enabled = false, cancelled_at = now(),
            serves_until = case when $2 then coalesce($3::timestamptz, serves_until) else null end,
            updated_at = now()
      where entitlement_id = $1`,
    [String(row.entitlement_id), plan.servesUntilPeriodEnd, servesUntil],
  );
  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'hosting.cancelled', String(row.entitlement_id), {
    leadId,
    from: plan.from,
    servesUntilPeriodEnd: plan.servesUntilPeriodEnd,
  });

  return {
    executed: true,
    entitlementId: String(row.entitlement_id),
    state: 'cancelled',
    renewalEnabled: false,
    servesUntilPeriodEnd: plan.servesUntilPeriodEnd,
    note: 'renewal disabled; history, offer and export are preserved',
  };
};

export const dispatchers: Record<string, ApprovalDispatcher> = {
  'outreach.send': outreachSend,
  'memory.adjudicate': memoryAdjudicate,
  'factory.deploy_site': factoryDeploySite,
  'playbooks.author': playbooksAuthor,
  'hosting.activate': hostingActivate,
  'hosting.cancel': hostingCancel,
};
