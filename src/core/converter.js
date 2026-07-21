// Client side of the optional local conversion agent.
//
// When configured, selected formats are POSTed to the agent, which returns a
// PDF (LibreOffice-rendered). We degrade gracefully: if the agent is down or a
// conversion fails, callers fall back to the in-browser viewer.

import { getConfig } from './config.js';

let agentDown = false; // set once we see the agent is unreachable this session

/** Should `format` be routed to the conversion agent? */
export function shouldConvert(format) {
  const c = getConfig().converter;
  if (!c || !c.url || agentDown) return false;
  const formats = c.formats || [];
  return formats.includes(format);
}

/**
 * Convert a file to PDF via the agent.
 * @returns {Promise<Uint8Array>} PDF bytes
 * @throws on network/agent/conversion failure (caller should fall back)
 */
export async function convertToPdf(bytes, filename) {
  const c = getConfig().converter;
  const url = c.url.replace(/\/$/, '') + '/convert';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.timeoutMs || 120000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(filename || 'input.bin'),
        ...(c.token ? { 'X-MV-Token': c.token } : {}),
      },
      body: bytes,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`agent ${res.status}: ${msg.slice(0, 200)}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    // Network-level failure (agent not running) → stop trying this session.
    if (err.name === 'AbortError' || err.name === 'TypeError') agentDown = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** For tests / re-probing after the agent (re)starts. */
export function resetAgentState() {
  agentDown = false;
}
