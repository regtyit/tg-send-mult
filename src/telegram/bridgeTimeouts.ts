import { config } from '../config';

/** Wall-clock timeout for full-account inbox scans (scheduler). */
export function listIncomingFullTimeoutMs(): number {
  const v = config.TG_BRIDGE_LIST_INCOMING_TIMEOUT_MS;
  return v > 0 ? v : 0;
}

/** Wall-clock timeout for single-peer inbox polls (dialogs). */
export function listIncomingPeerTimeoutMs(): number {
  const v = config.TG_BRIDGE_LIST_INCOMING_PEER_TIMEOUT_MS;
  return v > 0 ? v : 0;
}

export function defaultBridgeTimeoutMs(): number {
  const v = config.TG_BRIDGE_TIMEOUT_MS;
  return v > 0 ? v : 0;
}
