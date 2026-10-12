/** Bundle candidates without waiting for an unresponsive alternate TURN transport. */
export async function gatherCallIce(connection: RTCPeerConnection, timeoutMs = 12000) {
  if (connection.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let relayTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      finish(/^a=candidate:/m.test(connection.localDescription?.sdp ?? '')
        ? undefined : Error('Could not prepare the audio connection. Please try again.'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      clearTimeout(relayTimer);
      connection.removeEventListener('icegatheringstatechange', changed);
      connection.removeEventListener('icecandidate', changed);
      connection.removeEventListener('connectionstatechange', changed);
    }
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    }
    function changed() {
      if (connection.connectionState === 'closed') {
        finish(new DOMException('Call canceled', 'AbortError'));
      } else if (connection.iceGatheringState === 'complete') {
        finish();
      } else if (relayTimer === undefined && /^a=candidate:.*\btyp relay\b/m.test(connection.localDescription?.sdp ?? '')) {
        // A relay candidate provides a cross-network route. Briefly collect its
        // companion candidates, then signal without waiting for every endpoint.
        // Host-only candidates retain the longer fallback for NAT traversal.
        relayTimer = setTimeout(() => finish(), 200);
      }
    }
    connection.addEventListener('icegatheringstatechange', changed);
    connection.addEventListener('icecandidate', changed);
    connection.addEventListener('connectionstatechange', changed);
    changed();
  });
}
