export type MediaPreferences = {
  microphone: string;
  speaker: string;
  camera: string;
  microphoneVolume: number;
  speakerVolume: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  mirror: boolean;
};
export const defaultMediaPreferences: MediaPreferences = {
  microphone: "default",
  speaker: "default",
  camera: "default",
  microphoneVolume: 1,
  speakerVolume: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: false,
  mirror: true,
};
const key = "logisticall.media-preferences.v1";
export function readMediaPreferences(): MediaPreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "{}");
    const next = { ...defaultMediaPreferences };
    for (const field of ["microphone", "speaker", "camera"] as const)
      if (typeof raw[field] === "string" && raw[field].length <= 1000)
        next[field] = raw[field] || "default";
    for (const field of ["microphoneVolume", "speakerVolume"] as const)
      if (typeof raw[field] === "number" && Number.isFinite(raw[field]))
        next[field] = Math.max(0, Math.min(1, raw[field]));
    for (const field of [
      "noiseSuppression",
      "echoCancellation",
      "autoGainControl",
      "mirror",
    ] as const)
      if (typeof raw[field] === "boolean") next[field] = raw[field];
    return next;
  } catch {
    return { ...defaultMediaPreferences };
  }
}
export function saveMediaPreferences(value: MediaPreferences) {
  localStorage.setItem(key, JSON.stringify(value));
}
export function microphoneConstraints(
  value: MediaPreferences,
): MediaTrackConstraints {
  return {
    ...(value.microphone !== "default"
      ? { deviceId: { exact: value.microphone } }
      : {}),
    echoCancellation: value.echoCancellation,
    noiseSuppression: value.noiseSuppression,
    autoGainControl: value.autoGainControl,
  };
}
export type MicrophoneCapture = {
  stream: MediaStream;
  raw: MediaStream;
  close: () => void;
};
export async function captureMicrophone(
  value = readMediaPreferences(),
  fallback = true,
): Promise<MicrophoneCapture> {
  let raw: MediaStream;
  try {
    raw = await navigator.mediaDevices.getUserMedia({
      audio: microphoneConstraints(value),
      video: false,
    });
  } catch (error) {
    if (
      !fallback ||
      value.microphone === "default" ||
      !(error instanceof Error) ||
      !["NotFoundError", "OverconstrainedError"].includes(error.name)
    )
      throw error;
    raw = await navigator.mediaDevices.getUserMedia({
      audio: microphoneConstraints({ ...value, microphone: "default" }),
      video: false,
    });
  }
  let context: AudioContext | null = null;
  let output = raw;
  const close = () => {
    raw.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    if (output !== raw)
      output.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
    if (context) {
      void context.close().catch(() => {});
      context = null;
    }
  };
  try {
    if (!value.autoGainControl && value.microphoneVolume !== 1) {
      context = new AudioContext();
      await context.resume();
      const input = context.createMediaStreamSource(raw),
        gain = context.createGain(),
        destination = context.createMediaStreamDestination();
      gain.gain.value = value.microphoneVolume;
      input.connect(gain);
      gain.connect(destination);
      output = destination.stream;
      raw.getAudioTracks().forEach((t) => {
        t.onended = () =>
          output
            .getAudioTracks()
            .forEach((track) => track.dispatchEvent(new Event("ended")));
      });
    }
    return { stream: output, raw, close };
  } catch (error) {
    close();
    throw error;
  }
}
export async function configureSpeaker(
  audio: HTMLAudioElement,
  value = readMediaPreferences(),
  fallback = true,
) {
  audio.volume = value.speakerVolume;
  if (typeof audio.setSinkId !== "function") {
    if (!fallback && value.speaker !== "default")
      throw Error(
        "This browser uses the system speaker. Choose System default.",
      );
    return;
  }
  try {
    await audio.setSinkId(value.speaker === "default" ? "" : value.speaker);
  } catch (error) {
    if (!fallback || value.speaker === "default") throw error;
    await audio.setSinkId("");
  }
}
export function speakerTestBlob() {
  const rate = 24000,
    count = rate,
    bytes = new ArrayBuffer(44 + count * 2),
    view = new DataView(bytes);
  const str = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const envelope = Math.min(t / 0.03, 1, (1 - t) / 0.1);
    view.setInt16(
      44 + i * 2,
      Math.sin(2 * Math.PI * (t < 0.5 ? 440 : 660) * t) *
        envelope *
        0.2 *
        32767,
      true,
    );
  }
  return new Blob([bytes], { type: "audio/wav" });
}
