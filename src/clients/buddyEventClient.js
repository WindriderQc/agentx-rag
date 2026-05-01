/**
 * Buddy event client — fire-and-forget emit to core's bus.
 *
 * Posts to core's POST /api/buddy/emit so the event reaches every browser
 * tab subscribed to /api/buddy/events/stream — including tabs on this
 * service's own origin via the local buddy proxy.
 *
 * Failures are swallowed: buddy is non-critical infrastructure. A rag
 * ingest must not fail because the buddy bus is down.
 */

const CORE_URL = process.env.CORE_URL || process.env.CORE_PROXY_URL || 'http://localhost:3080';

function emitBuddyEvent(type, eventClass, summary, significance) {
  const body = JSON.stringify({
    type,
    class: eventClass,
    summary,
    significance: significance || 'normal',
  });

  fetch(`${CORE_URL}/api/buddy/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => {
    // Silent — buddy is best-effort observability.
  });
}

module.exports = { emitBuddyEvent };
