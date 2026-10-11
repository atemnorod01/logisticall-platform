/** Compact peak envelope, combining channels so either channel remains visible. */
export function waveformPeaks(channels: Float32Array[], count = 64): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length) return Array(count).fill(0);
  const peaks = Array.from({ length: count }, (_, bin) => {
    const start = Math.floor((bin * length) / count);
    const end = Math.max(start + 1, Math.floor(((bin + 1) * length) / count));
    const stride = Math.max(1, Math.floor((end - start) / 2000));
    let peak = 0;
    for (const channel of channels)
      for (let i = start; i < Math.min(end, channel.length); i += stride)
        peak = Math.max(peak, Math.abs(channel[i]!));
    return peak;
  });
  const max = Math.max(...peaks);
  return max ? peaks.map((p) => p / max) : peaks;
}
export function audioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
