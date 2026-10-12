import { gatherCallIce } from "./call-ice.js";
import { voicemailController, type VoicemailState } from "./voicemail.js";
import type {
  AudioCall,
  CallTarget,
} from "../../../packages/types/src/calls.js";
export type CallState = {
  voicemail: VoicemailState | null;
  calls: AudioCall[];
  current: AudioCall | null;
  preparing: boolean;
  preparation: "microphone" | "network" | "signaling";
  connected: boolean;
  muted: boolean;
  error: string;
  audioBlocked: boolean;
  ready: boolean;
  unread: number;
};
export function callController(
  organizationId: string,
  userId: string,
  csrf: string,
) {
  const client = crypto.randomUUID();
  let state: CallState = {
    voicemail: null,
    calls: [],
    current: null,
    preparing: false,
    preparation: "microphone",
    connected: false,
    muted: false,
    error: "",
    audioBlocked: false,
    ready: false,
    unread: 0,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CallState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };
  const voicemail = voicemailController(organizationId, csrf, (value) =>
    publish({ voicemail: value }),
  );
  let outgoingTarget: CallTarget | null = null;
  function beginVoicemail(target: CallTarget, callId: string) {
    release();
    outgoingTarget = null;
    publish({ current: null, error: "" });
    void voicemail.begin(target, callId);
  }
  let pc: RTCPeerConnection | null = null,
    stream: MediaStream | null = null;
  let audio: HTMLAudioElement | null = null;
  let revision = 0;
  let disposed = false,
    generation = 0,
    syncing = false,
    syncPending = false,
    applyingAnswer = false,
    lastSync = Date.now();
  let iceServers: RTCIceServer[] = [],
    pendingId: string | null = null,
    connectionTimer: ReturnType<typeof setTimeout> | undefined;
  const owns = (c: AudioCall) =>
    c.caller.id === userId
      ? c.callerClient === client
      : c.calleeClient === client;
  const incoming = (c: AudioCall) =>
    c.callee.id === userId && c.callee.organizationId === organizationId;
  async function request(data: object, keepalive = false) {
    const response = await fetch(`/v1/organizations/${organizationId}/calls`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      keepalive,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ ...data, client }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Object.assign(
        Error(body.message || "Calling service unavailable. Please try again."),
        { code: body.code },
      );
    }
    return await response.json();
  }
  function release() {
    generation++;
    revision++;
    clearTimeout(connectionTimer);
    connectionTimer = undefined;
    pc?.close();
    pc = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio = null;
    }
    pendingId = null;
    publish({
      preparing: false,
      connected: false,
      muted: false,
      audioBlocked: false,
    });
  }
  async function end() {
    if (state.voicemail) {
      voicemail.finish();
      return;
    }
    outgoingTarget = null;
    const id = state.current?.id ?? pendingId;
    release();
    publish({ current: null });
    if (id)
      try {
        await request({ action: "end", id }, true);
        await sync();
      } catch {
        if (!state.error)
          publish({
            error:
              "Disconnected locally. The other side will disconnect when the connection times out.",
          });
      }
  }
  function ensureLive(version: number) {
    if (disposed || version !== generation)
      throw new DOMException("Call canceled", "AbortError");
  }
  async function peer(version: number) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw Error(
        "Audio calling requires a supported browser with microphone access on HTTPS.",
      );
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    if (disposed || version !== generation) {
      media.getTracks().forEach((t) => t.stop());
      ensureLive(version);
    }
    stream = media;
    publish({ preparation: "network" });
    const connection = new RTCPeerConnection({ iceServers });
    pc = connection;
    audio = new Audio();
    audio.autoplay = true;
    connection.ontrack = (e) => {
      if (!audio || pc !== connection) return;
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void audio.play().catch(() => publish({ audioBlocked: true }));
    };
    connection.onconnectionstatechange = () => {
      if (pc !== connection) return;
      publish({ connected: connection.connectionState === "connected" });
      clearTimeout(connectionTimer);
      if (connection.connectionState === "connected") return;
      if (connection.connectionState === "failed") {
        publish({ error: "Audio connection failed. Please try again." });
        void end();
      } else
        connectionTimer = setTimeout(() => {
          publish({ error: "The audio connection was lost." });
          void end();
        }, 20000);
    };
    for (const track of media.getTracks()) {
      connection.addTrack(track, media);
      track.onended = () => {
        if (pc === connection) {
          publish({ error: "Microphone disconnected." });
          void end();
        }
      };
    }
    return connection;
  }
  async function description(
    connection: RTCPeerConnection,
    type: "offer" | "answer",
    version: number,
  ) {
    await connection.setLocalDescription(
      type === "offer"
        ? await connection.createOffer()
        : await connection.createAnswer(),
    );
    // Bundle ICE candidates with SDP: signaling remains replica-safe through ordinary HTTPS.
    await gatherCallIce(connection);
    ensureLive(version);
    return connection.localDescription!.sdp;
  }
  async function failed(error: unknown, version: number) {
    if (version !== generation || disposed) return;
    const message =
      error instanceof DOMException &&
      ["NotAllowedError", "PermissionDeniedError"].includes(error.name)
        ? "Microphone permission was denied. Allow microphone access and try again."
        : error instanceof Error
          ? error.message
          : "Could not start audio.";
    publish({ error: message });
    await end();
  }
  async function start(target: CallTarget) {
    if (
      disposed ||
      state.preparing ||
      state.current ||
      state.voicemail ||
      !state.ready
    )
      return;
    outgoingTarget = target;
    publish({ preparing: true, preparation: "microphone", error: "" });
    const version = ++generation;
    const id = crypto.randomUUID();
    pendingId = id;
    try {
      const connection = await peer(version);
      const offer = await description(connection, "offer", version);
      publish({ preparation: "signaling" });
      const result = await request({
        action: "create",
        id,
        target: { id: target.id, organizationId: target.organizationId, ...(target.kind ? {kind:target.kind} : {}) },
        offer,
        ...(target.conversationId
          ? {
              source: {
                conversationId: target.conversationId,
                ...(target.groupId ? { groupId: target.groupId } : {}),
              },
            }
          : {}),
      });
      if (disposed || version !== generation) {
        await request({ action: "end", id }, true);
        return;
      }
      revision++;
      publish({ current: result.call, preparing: false });
      await sync();
    } catch (e) {
      if (
        !disposed &&
        version === generation &&
        e instanceof Error &&
        "code" in e &&
        e.code === "recipient_unavailable"
      )
        if (target.kind !== "group") beginVoicemail(target, id);
        else await failed(e, version);
      else await failed(e, version);
    }
  }
  async function accept() {
    const call = state.current;
    if (
      !call ||
      !incoming(call) ||
      call.status !== "ringing" ||
      state.preparing
    )
      return;
    publish({ preparing: true, preparation: "microphone", error: "" });
    const version = ++generation;
    try {
      const result = await request({ action: "accept", id: call.id });
      ensureLive(version);
      publish({ current: result.call });
      const connection = await peer(version);
      await connection.setRemoteDescription({ type: "offer", sdp: call.offer });
      const answer = await description(connection, "answer", version);
      publish({ preparation: "signaling" });
      const accepted = await request({ action: "answer", id: call.id, answer });
      ensureLive(version);
      revision++;
      publish({ current: accepted.call, preparing: false });
    } catch (e) {
      await failed(e, version);
    }
  }
  async function sync() {
    if (disposed) return;
    if (syncing) { syncPending = true; return; }
    syncing = true;
    const syncRevision = revision;
    try {
      const result = await request({ action: "sync" });
      if (disposed) return;
      lastSync = Date.now();
      iceServers = result.iceServers;
      const calls = result.calls as AudioCall[];
      const current = calls.find((c) => c.status !== "ended") ?? null;
      publish({ calls, ready: true, unread: typeof result.unread === "number" ? result.unread : 0 });
      if (syncRevision !== revision || state.preparing || state.voicemail)
        return;
      const previous = state.current;
      const ended =
        previous &&
        calls.find((c) => c.id === previous.id && c.status === "ended");
      if (
        !current &&
        previous &&
        owns(previous) &&
        !incoming(previous) &&
        !previous.acceptedAt &&
        outgoingTarget && outgoingTarget.kind !== "group" &&
        ended &&
        ["No answer", "Declined"].includes(ended.reason ?? "")
      ) {
        beginVoicemail(outgoingTarget, previous.id);
        return;
      }
      if (
        state.current &&
        (!current || (current.calleeClient && !owns(current)))
      )
        release();
      // A second tab displays the call but never acquires its microphone.
      publish({ current });
      if (
        current?.answer &&
        pc &&
        owns(current) &&
        current.caller.id === userId &&
        !pc.remoteDescription &&
        !applyingAnswer
      ) {
        applyingAnswer = true;
        const connection = pc;
        try {
          await connection.setRemoteDescription({
            type: "answer",
            sdp: current.answer,
          });
        } catch (e) {
          await failed(e, generation);
        } finally {
          applyingAnswer = false;
        }
      }
    } catch {
      if (disposed) return;
      publish({ ready: false });
      if (Date.now() - lastSync > 20000 && (state.current || state.preparing)) {
        release();
        publish({
          current: null,
          error:
            "Connection to the calling service was lost. Call disconnected.",
        });
      }
    } finally {
      syncing = false;
      if (syncPending && !disposed) { syncPending = false; void sync(); }
    }
  }
  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    snapshot: () => state,
    start,
    voicemail,
    accept,
    end,
    sync,
    async review(before: number) {
      const result = await request({ action: "review", before });
      if (!disposed) publish({ unread: result.unread });
    },
    incoming,
    owns,
    mute() {
      if (!stream) return;
      const muted = !state.muted;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
      publish({ muted });
    },
    play() {
      void audio
        ?.play()
        .then(() => publish({ audioBlocked: false }))
        .catch(() =>
          publish({
            error:
              "Audio playback is blocked. Check your browser sound settings.",
          }),
        );
    },
    leave() {
      if ((state.current && owns(state.current)) || pendingId) void end();
    },
    clearError() {
      publish({ error: "" });
    },
    dispose() {
      disposed = true;
      voicemail.dispose();
      const id =
        state.current && owns(state.current) ? state.current.id : pendingId;
      release();
      if (id) void request({ action: "end", id }, true).catch(() => {});
      listeners.clear();
    },
  };
}
