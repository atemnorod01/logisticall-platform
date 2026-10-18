import { z } from "zod";
import { NetsapiensCreateRejected } from "./netsapiens-provisioning-options";

const origin = "https://pbx.ringlogix.com";
const inputSchema = z.object({
  domain: z.string().regex(/^[1-9]\d*$/),
  user: z.string().regex(/^\d+$/),
  index: z.number().int().positive(),
  script: z.string().trim().min(1).max(500),
  voice: z.literal("en-US_AllisonVoice"),
  language: z.literal("en-US"),
});
type SpeechInput = z.infer<typeof inputSchema>;

export async function activateNetsapiensAnnouncement(
  domain: string,
  accessToken: string,
  request: typeof fetch = fetch,
) {
  z.string()
    .regex(/^[1-9]\d*$/)
    .parse(domain);
  // v1 reads expose these native fields. The portal's for_enable/for_numbers
  // aliases are ignored by action=update on this server. Preserve all other
  // answer-rule fields, including its priority and simultaneous-ring settings.
  const query = new URLSearchParams({
    object: "answerrule",
    action: "update",
    domain,
    user: "9999",
    extension: "9999",
    id: `9999@${domain}`,
    time_frame: "*",
    for_control: "e",
    for_parameters: "Announce_999903",
    format: "json",
  });
  const response = await request(origin + "/ns-api/?" + query, {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if ([400, 401, 403, 404, 422, 429].includes(response.status))
    throw new NetsapiensCreateRejected(
      `NetSapiens rejected the Default greeting activation (HTTP ${response.status}).`,
    );
  if (!response.ok)
    throw new Error(
      `NetSapiens greeting activation is unconfirmed (HTTP ${response.status}). Resume to verify saved progress.`,
    );
}

// RingLogix 44.4's v2 media endpoints reject TTS/uploads. Use the same
// first-party voice service and audio upload API as its Manager Portal.
// Voice credentials stay in memory and are never sent outside this origin.
export async function createNetsapiensSpeechGreeting(
  input: SpeechInput,
  accessToken: string,
  request: typeof fetch = fetch,
) {
  const data = inputSchema.parse(input);
  const auth = { Authorization: "Bearer " + accessToken };
  const options = {
    redirect: "error" as const,
    signal: AbortSignal.timeout(30000),
  };
  let audio: Uint8Array<ArrayBuffer>;
  try {
    const tokenResponse = await request(
      origin +
        "/ns-api/voice/token?" +
        new URLSearchParams({ domain: data.domain, user: data.user }),
      {
        ...options,
        method: "POST",
        headers: { ...auth, AsDomain: data.domain },
      },
    );
    if (!tokenResponse.ok) throw new Error();
    const session = z
      .object({
        token: z.string().min(1),
        serviceBaseUriProxied: z.literal(origin + "/voice-services"),
      })
      .parse(await tokenResponse.json());
    const voiceAuth = { Authorization: "Bearer " + session.token };
    const catalogue = await request(
      session.serviceBaseUriProxied +
        "/voices?" +
        new URLSearchParams({ language: data.language }),
      { ...options, headers: voiceAuth },
    );
    if (!catalogue.ok) throw new Error();
    const voices = z
      .object({
        voices: z.array(
          z.object({
            id: z.string(),
            languageCode: z.string(),
            type: z.string(),
            name: z.string(),
            gender: z.string(),
            subType: z.string(),
          }),
        ),
      })
      .parse(await catalogue.json());
    const matches = voices.voices.filter(
      (v) =>
        v.id === data.voice &&
        v.languageCode === data.language &&
        v.type === "watson",
    );
    if (matches.length !== 1) throw new Error();
    const result = await request(session.serviceBaseUriProxied + "/tts", {
      ...options,
      signal: AbortSignal.timeout(30000),
      method: "POST",
      headers: { ...voiceAuth, "Content-Type": "application/json" },
      body: JSON.stringify({ voice: matches[0], text: data.script }),
    });
    if (!result.ok) throw new Error();
    const generated = z
      .object({
        contentType: z.literal("audio/mpeg"),
        audioStream: z.object({
          type: z.literal("Buffer"),
          data: z.array(z.number().int().min(0).max(255)).min(1).max(2_000_000),
        }),
      })
      .parse(await result.json());
    audio = new Uint8Array(generated.audioStream.data);
  } catch {
    // No PBX audio resource has been written yet, so a later resume can retry.
    throw new NetsapiensCreateRejected(
      "NetSapiens could not generate the Allison (Watson) greeting. No greeting was uploaded.",
    );
  }
  const query = new URLSearchParams({
    object: "audio",
    action: "upload",
    convert: "yes",
    format: "mp3",
    index: String(data.index),
    script: data.script,
    moh_script: data.script,
    type: "greeting",
    domain: data.domain,
    user: data.user,
    owner: data.user,
    owner_domain: data.domain,
    source_type: "tts",
    voice_id: data.voice,
    voice_language: data.language,
  });
  const body = new FormData();
  body.append(
    "file",
    new Blob([audio], { type: "audio/mpeg" }),
    "greeting.mp3",
  );
  body.append("format", "mp3");
  // Uploads are never automatically replayed. The caller persists an intent
  // before entering this function and verifies the exact greeting afterwards.
  const uploaded = await request(origin + "/ns-api/?" + query, {
    ...options,
    signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: auth,
    body,
  });
  if ([400, 401, 403, 404, 422, 429].includes(uploaded.status))
    throw new NetsapiensCreateRejected(
      `NetSapiens rejected the greeting upload (HTTP ${uploaded.status}).`,
    );
  if (!uploaded.ok)
    throw new Error(
      `NetSapiens greeting upload is unconfirmed (HTTP ${uploaded.status}). Resume to verify saved progress.`,
    );
}
