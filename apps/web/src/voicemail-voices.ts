import type { VoicemailSettings } from "../../../packages/types/src/voicemail.js";
export type SavedVoice = VoicemailSettings["standardVoice"];
const effects = new Set([
  "Albert",
  "Bad News",
  "Bahh",
  "Bells",
  "Boing",
  "Bubbles",
  "Cellos",
  "Good News",
  "Jester",
  "Junior",
  "Organ",
  "Ralph",
  "Superstar",
  "Trinoids",
  "Whisper",
  "Wobble",
  "Zarvox",
]);
const accents: Record<string, string> = {
  "en-US": "American",
  "en-GB": "British",
  "en-AU": "Australian",
  "en-IE": "Irish",
  "en-IN": "Indian",
  "en-ZA": "South African",
};
export function voiceCategory(
  voice: Pick<SpeechSynthesisVoice, "name" | "lang">,
) {
  if (/^Google\b/i.test(voice.name)) return "Google online voices";
  if (effects.has(voice.name) || /^(Grandma|Grandpa)\b/.test(voice.name))
    return "Character effects";
  const lang = voice.lang.replaceAll("_", "-");
  return accents[lang] || `Other languages · ${lang}`;
}
export function standardGreeting(name: string) {
  const person = name.trim();
  return `Hi, you've reached ${person ? `${person}'s voicemail box` : "voicemail"}. They're not available right now. Please leave a message, and they'll call you back as soon as possible.`;
}
export function savedVoice(voice: SpeechSynthesisVoice) {
  return {
    name: voice.name,
    lang: voice.lang,
    uri: voice.voiceURI,
    category: voiceCategory(voice),
  };
}
export function findGreetingVoice(
  selection: SavedVoice,
  voices: SpeechSynthesisVoice[],
) {
  if (!selection) return undefined;
  return (
    voices.find(
      (v) =>
        v.voiceURI === selection.uri &&
        v.name === selection.name &&
        v.lang === selection.lang,
    ) ||
    voices.find((v) => v.name === selection.name && v.lang === selection.lang)
  );
}
export function configureGreetingVoice(
  utterance: SpeechSynthesisUtterance,
  selection: SavedVoice,
  voices: SpeechSynthesisVoice[],
) {
  const exact = findGreetingVoice(selection, voices);
  const voice =
    exact ||
    voices.find((v) => v.lang === (selection?.lang || "en-US") && v.default) ||
    voices.find((v) => v.lang === (selection?.lang || "en-US"));
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || selection?.lang || "en-US";
  utterance.rate = 0.95;
}
export async function loadGreetingVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  if (!synth?.getVoices) return [];
  const voices = synth.getVoices();
  if (voices.length) return voices;
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", changed);
      resolve(synth.getVoices());
    };
    const changed = () => {
      if (synth.getVoices().length) done();
    };
    const timer = setTimeout(done, 1500);
    synth.addEventListener("voiceschanged", changed);
  });
}
