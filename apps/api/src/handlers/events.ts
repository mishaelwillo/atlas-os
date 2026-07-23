/**
 * events.site — deployed sites post form/chat/call events here.
 * Creates a conversation + inbound message, then enqueues a qualification run.
 * Visitor payloads are UNTRUSTED (SECURITY.md §Untrusted content): stored as
 * data; the qualification worker consumes them via frozen playbook prefixes.
 */
import { CapabilityError, type CapabilityHandler } from '../pipeline.js';

const CHANNELS = new Set(['form', 'chat', 'call', 'whatsapp', 'email', 'sms']);

export const eventsSite: CapabilityHandler = async (ctx, input) => {
  const siteId = input.siteId as string;
  const channel = input.channel as string;
  const payload = input.payload as Record<string, unknown>;
  if (!CHANNELS.has(channel)) {
    throw new CapabilityError(400, `channel must be one of: ${[...CHANNELS].join(', ')}`);
  }
  if (ctx.spaceId === null) throw new CapabilityError(400, 'events.site requires a space');

  const site = await ctx.q.query(`select site_id from sites where site_id = $1 and space_id = $2`, [siteId, ctx.spaceId]);
  if (site.rows.length === 0) throw new CapabilityError(404, 'unknown site for this space');

  const contactRaw = (payload.contact ?? {}) as Record<string, unknown>;
  const contact = {
    name: typeof contactRaw.name === 'string' ? contactRaw.name : undefined,
    phone: typeof contactRaw.phone === 'string' ? contactRaw.phone : undefined,
    email: typeof contactRaw.email === 'string' ? contactRaw.email : undefined,
  };

  const convo = await ctx.q.query(
    `insert into conversations (space_id, site_id, channel, contact, status)
     values ($1, $2, $3, $4, 'open') returning conversation_id`,
    [ctx.spaceId, siteId, channel, JSON.stringify(contact)],
  );
  const conversationId = String(convo.rows[0].conversation_id);

  const body = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload);
  await ctx.q.query(
    `insert into messages (conversation_id, direction, sender, body) values ($1, 'inbound', 'visitor', $2)`,
    [conversationId, body],
  );

  // Qualification run enqueued for the worker — never answered inline.
  await ctx.q.query(
    `insert into runs (space_id, capability, task_class, status, input)
     values ($1, 'conversation.qualify', 'quick', 'queued', $2)`,
    [ctx.spaceId, JSON.stringify({ conversationId, siteId, channel })],
  );

  return { conversationId };
};
