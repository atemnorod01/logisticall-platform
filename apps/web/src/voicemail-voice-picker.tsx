import { useEffect, useRef, useState } from "react";
import {
  configureGreetingVoice,
  findGreetingVoice,
  savedVoice,
  standardGreeting,
  voiceCategory,
  type SavedVoice,
} from "./voicemail-voices.js";
export function VoicemailVoicePicker({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: SavedVoice;
  onChange: (voice: SavedVoice) => void;
  disabled: boolean;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [category, setCategory] = useState(value?.category || "American");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    if (utterance.current) {
      utterance.current.onend = null;
      utterance.current.onerror = null;
      utterance.current = null;
      window.speechSynthesis?.cancel();
    }
    setPlaying(false);
  }
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => {
      synth.removeEventListener("voiceschanged", update);
      stop();
    };
  }, []);
  useEffect(() => {
    setCategory(value?.category || "American");
    stop();
  }, [value, name]);
  const groups = [
    ...new Set([
      "American",
      "British",
      "Australian",
      "Irish",
      "Indian",
      "South African",
      "Google online voices",
      "Character effects",
      ...voices.map(voiceCategory),
      ...(value ? [value.category] : []),
    ]),
  ];
  const options = voices.filter((v) => voiceCategory(v) === category);
  const selected = findGreetingVoice(value, voices);
  const key = (v: SpeechSynthesisVoice) =>
    JSON.stringify([v.voiceURI, v.name, v.lang]);
  function play() {
    if (playing) {
      stop();
      return;
    }
    setError("");
    setStatus("");
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setError("Speech playback is not supported in this browser.");
      return;
    }
    const speech = new SpeechSynthesisUtterance(standardGreeting(name));
    configureGreetingVoice(speech, value, voices);
    utterance.current = speech;
    speech.onstart = () => setStatus("Playing greeting…");
    speech.onend = () => {
      setStatus("Preview finished.");
      utterance.current = null;
      clearTimeout(timer.current);
      setPlaying(false);
    };
    speech.onerror = () => {
      stop();
      setError("Could not play this voice. Try again or select another voice.");
    };
    setPlaying(true);
    timer.current = setTimeout(() => {
      stop();
      setError("Playback did not finish. Try another voice.");
    }, 45000);
    window.speechSynthesis.speak(speech);
  }
  return (
    <div className="lc-standard-greeting">
      <p className="lc-greeting-text">{standardGreeting(name)}</p>
      <div className="lc-voice-selectors">
        <label>
          Accent / voice type
          <select
            aria-label="Accent / voice type"
            value={category}
            disabled={disabled}
            onChange={(e) => {
              stop();
              setError("");
              setCategory(e.target.value);
              const first = voices.find(
                (v) => voiceCategory(v) === e.target.value,
              );
              if (first) onChange(savedVoice(first));
            }}
          >
            {groups.map((g) => (
              <option
                key={g}
                value={g}
                disabled={!voices.some((v) => voiceCategory(v) === g)}
              >
                {g}
              </option>
            ))}
          </select>
        </label>
        <label>
          Voice
          <select
            aria-label="Voice"
            value={selected ? key(selected) : value ? "unavailable" : "default"}
            disabled={disabled || !voices.length}
            onChange={(e) => {
              stop();
              setError("");
              const voice = options.find((v) => key(v) === e.target.value);
              onChange(voice ? savedVoice(voice) : null);
            }}
          >
            {!value && <option value="default">Browser default</option>}
            {value && !selected && (
              <option value="unavailable">
                {value.name} (unavailable here)
              </option>
            )}
            {options.map((v) => (
              <option key={key(v)} value={key(v)}>
                {v.name}
                {!v.localService ? " · Online" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="button" disabled={disabled} onClick={play}>
        {playing ? "Stop preview" : "▶ Play greeting"}
      </button>
      {value && !selected && voices.length > 0 && (
        <p role="status">
          This voice is unavailable on this device. Preview will use a voice in
          the same language when available.
        </p>
      )}
      <p>
        Available voices depend on the browser and device. Callers without your
        selected voice will hear a fallback voice. The greeting stays in
        English.
      </p>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
