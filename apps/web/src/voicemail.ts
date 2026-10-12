import { voicemailSettings } from "../../../packages/types/src/voicemail.js";
import { greetingUrl } from "./voicemail-audio.js";
import type { CallTarget } from "../../../packages/types/src/calls.js";

export const voicemailGreeting =
  "Sorry, but this user is unavailable. Please leave your message, and the user will call you right back.";
export type VoicemailState = {
  target: CallTarget;
  phase: "preparing" | "greeting" | "recording" | "sending" | "sent" | "error";
  seconds: number;
  error: string;
  file: File | null;
};

export function voicemailController(
  org: string,
  csrf: string,
  changed: (state: VoicemailState | null) => void,
) {
  let state: VoicemailState | null = null;
  let version = 0,
    stream: MediaStream | null = null,
    recorder: MediaRecorder | null = null;
  let greetingAudio: HTMLAudioElement | null = null;
  let greetingObjectUrl = "";
  let context: AudioContext | null = null,
    utterance: SpeechSynthesisUtterance | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let groupId: string | undefined;
  let linkedCallId = "";
  let conversationId = "",
    attachmentId = "",
    messageId = "";
  let abort = new AbortController();
  const emit = (patch: Partial<VoicemailState>) => {
    if (state) {
      state = { ...state, ...patch };
      changed(state);
    }
  };
  const valid = (v: number) => v === version && state !== null;
  const base = `/v1/organizations/${org}/messaging`;
  async function request(path: string, method: string, body?: object | File) {
    const binary = body instanceof File;
    const response = await fetch(
      base + path + (groupId ? `?groupId=${encodeURIComponent(groupId)}` : ""),
      {
        method,
        credentials: "same-origin",
        headers: {
          "X-CSRF-Token": csrf,
          "Content-Type": binary
            ? "application/octet-stream"
            : "application/json",
          ...(binary ? { "X-File-Type": body.type } : {}),
        },
        body: binary ? body : JSON.stringify(body ?? {}),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
      },
    );
    if (!response.ok)
      throw Error(
        "Could not open voicemail for this person. Please try again.",
      );
    return response.json();
  }
  function stopMedia() {
    clearInterval(timer);
    if (greetingAudio) {
      greetingAudio.onended = null;
      greetingAudio.onerror = null;
      greetingAudio.pause();
      greetingAudio.src = "";
      greetingAudio = null;
    }
    if (greetingObjectUrl) {
      URL.revokeObjectURL(greetingObjectUrl);
      greetingObjectUrl = "";
    }
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
      window.speechSynthesis.cancel();
      utterance = null;
    }
    if (recorder) {
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
      recorder = null;
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (context) {
      void context.close().catch(() => {});
      context = null;
    }
  }
  function cancel() {
    version++;
    abort.abort();
    stopMedia();
    state = null;
    changed(null);
  }
  async function send() {
    if (!state?.file || state.phase === "sending") return;
    const v = version,
      file = state.file;
    emit({ phase: "sending", error: "" });
    try {
      if (!attachmentId) {
        const attachment = await request(
          `/${conversationId}/attachments`,
          "POST",
          { filename: file.name, mime: file.type, size: file.size },
        );
        if (!valid(v)) return;
        await request(
          `/${conversationId}/attachments/${attachment.id}`,
          "PUT",
          file,
        );
        if (!valid(v)) return;
        await request(
          `/${conversationId}/attachments/${attachment.id}/complete`,
          "POST",
        );
        if (!valid(v)) return;
        attachmentId = attachment.id;
      }
      // Keep the same message ID and ready attachment after an ambiguous send failure.
      await request(`/${conversationId}/messages`, "POST", {
        id: messageId,
        body: "Voicemail",
        internal: false,
        attachments: [attachmentId],
        voicemailFor: linkedCallId,
      });
      if (valid(v)) emit({ phase: "sent", file: null });
    } catch (e) {
      if (valid(v))
        emit({
          phase: "error",
          error:
            "Could not send your voice message. Your recording is kept here; retry or download it before leaving.",
        });
    }
  }
  function finish() {
    if (state?.phase === "recording" && recorder?.state === "recording") {
      clearInterval(timer);
      emit({ phase: "sending" });
      recorder.stop();
    } else if (state?.phase === "greeting" || state?.phase === "preparing")
      cancel();
  }
  async function playback<T>(task: Promise<T>, milliseconds: number) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const signal = abort.signal;
    let interrupted: (() => void) | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          interrupted = () =>
            reject(new DOMException("Voicemail canceled", "AbortError"));
          signal.addEventListener("abort", interrupted, { once: true });
          if (signal.aborted) interrupted();
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                Error(
                  "Audio playback did not start or finish. Click Try again to play the greeting.",
                ),
              ),
            milliseconds,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      if (interrupted) signal.removeEventListener("abort", interrupted);
    }
  }
  async function begin(target: CallTarget, callId: string) {
    linkedCallId = callId;
    cancel();
    abort = new AbortController();
    const v = version;
    conversationId = "";
    groupId = target.conversationId ? target.groupId : undefined;
    attachmentId = "";
    messageId = crypto.randomUUID();
    state = { target, phase: "preparing", seconds: 0, error: "", file: null };
    changed(state);
    try {
      if (!window.MediaRecorder)
        throw Error(
          "This browser cannot play the voicemail greeting or record audio. Try a supported browser.",
        );
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!valid(v)) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = media;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
      const person = { id: target.id, organizationId: target.organizationId };
      if (target.conversationId) {
        conversationId = target.conversationId;
      } else {
        const result = await request("", "POST", {
          target: { kind: "user", ...person },
        });
        if (!valid(v)) return;
        conversationId = result.conversation.id;
      }
      const preferencesResponse = await fetch(
        `/v1/organizations/${org}/calls`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({
            action: "voicemail",
            client: crypto.randomUUID(),
            target: person,
            ...(target.conversationId
              ? {
                  source: {
                    conversationId: target.conversationId,
                    ...(target.groupId ? { groupId: target.groupId } : {}),
                  },
                }
              : {}),
          }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        },
      );
      if (!preferencesResponse.ok)
        throw Error(
          "Could not load this person's voicemail greeting. Please try again.",
        );
      const preferences = voicemailSettings.parse(
        (await preferencesResponse.json()).settings,
      );
      if (!valid(v)) return;
      context = new AudioContext();
      await playback(context.resume(), 3000);
      if (!valid(v)) return;
      emit({ phase: "greeting" });
      if (preferences.greeting) {
        greetingObjectUrl = greetingUrl(preferences.greeting);
        greetingAudio = new Audio(greetingObjectUrl);
        const player = greetingAudio;
        await playback(
          new Promise<void>((resolve, reject) => {
            player.onended = () => resolve();
            player.onerror = () =>
              reject(
                Error(
                  "Could not play the personal greeting. Please try again.",
                ),
              );
            void player
              .play()
              .catch(() =>
                reject(
                  Error(
                    "Greeting playback was blocked. Click Try again to play it.",
                  ),
                ),
              );
          }),
          90000,
        );
      } else {
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance)
          throw Error(
            "This browser cannot play the standard greeting. Try a supported browser.",
          );
        await playback(
          new Promise<void>((resolve, reject) => {
            utterance = new SpeechSynthesisUtterance(voicemailGreeting);
            utterance.lang = "en-US";
            utterance.rate = 0.95;
            utterance.onend = () => resolve();
            utterance.onerror = () =>
              reject(
                Error(
                  "Greeting playback was blocked. Click Try again to play it and start voicemail.",
                ),
              );
            window.speechSynthesis.speak(utterance);
          }),
          30000,
        );
      }
      if (!valid(v) || !context) return;
      await new Promise<void>((resolve) => {
        const oscillator = context!.createOscillator(),
          gain = context!.createGain();
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.12, context!.currentTime);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          context!.currentTime + 0.28,
        );
        oscillator.connect(gain);
        gain.connect(context!.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          resolve();
        };
        oscillator.start();
        oscillator.stop(context!.currentTime + 0.3);
      });
      if (!valid(v) || !stream) return;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 128000,
      });
      const recording = recorder,
        chunks: Blob[] = [];
      let size = 0;
      recording.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          size += e.data.size;
          if (size >= 24 * 1024 * 1024) finish();
        }
      };
      recording.onerror = () => {
        if (valid(v)) {
          stopMedia();
          emit({
            phase: "error",
            error: "Microphone recording failed. Please try again.",
          });
        }
      };
      recording.onstop = () => {
        if (!valid(v)) return;
        const mime = recording.mimeType.split(";")[0] || "audio/webm";
        const blob = new Blob(chunks, { type: mime });
        stopMedia();
        if (!blob.size) {
          emit({
            phase: "error",
            error: "No audio was recorded. Please try again.",
          });
          return;
        }
        emit({
          phase: "recording",
          file: new File(
            [blob],
            `Voicemail-${new Date().toISOString().replaceAll(":", "-")}.${mime === "audio/mp4" ? "m4a" : mime === "audio/ogg" ? "ogg" : "webm"}`,
            { type: mime },
          ),
        });
        void send();
      };
      stream.getAudioTracks().forEach((t) => {
        t.enabled = true;
        t.onended = () => finish();
      });
      recording.start(250);
      const started = Date.now();
      emit({ phase: "recording" });
      timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        emit({ seconds });
        if (seconds >= 300) finish();
      }, 250);
    } catch (e) {
      if (!valid(v)) return;
      stopMedia();
      emit({
        phase: "error",
        error: e instanceof Error ? e.message : "Could not start voicemail.",
      });
    }
  }
  function download() {
    if (!state?.file) return;
    const url = URL.createObjectURL(state.file),
      link = document.createElement("a");
    link.href = url;
    link.download = state.file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return {
    begin,
    finish,
    cancel,
    send,
    download,
    retry() {
      if (state?.file) void send();
      else if (state) void begin(state.target, linkedCallId);
    },
    dispose: cancel,
  };
}
