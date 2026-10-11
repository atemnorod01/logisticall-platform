/** Some networks never finish gathering every TURN transport. Keep usable candidates. */
export async function gatherCallIce(connection: RTCPeerConnection, timeoutMs = 12000) {
  if (connection.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      if (/^a=candidate:/m.test(connection.localDescription?.sdp ?? '')) resolve();
      else reject(Error('Could not prepare the audio connection. Please try again.'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      connection.removeEventListener('icegatheringstatechange', changed);
    }
    function changed() {
      if (connection.iceGatheringState === 'complete') { cleanup(); resolve(); }
    }
    connection.addEventListener('icegatheringstatechange', changed);
    changed();
  });
}
