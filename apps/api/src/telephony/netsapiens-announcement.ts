import {
  inventoryAttendantName,
  inventoryAnnouncementText,
} from "./announcement-text";
import { z } from "zod";
import { NetsapiensCreateRejected } from "./netsapiens-provisioning-options";
import { concurrentWork } from "./concurrent-work";

export const companyAnnouncement = {
  user: "9999",
  name: inventoryAttendantName,
  voice: "en-US_AllisonVoice",
  language: "en-US",
  timeframe: "*",
  greetingIndex: 999903,
} as const;
export const announcementMenuDefaults = {
  "no-key-press": "repeat",
  "unassigned-key-press": "repeat",
} as const;
export type AnnouncementProgress = {
  companyName: string;
  created?: boolean;
  pending?: string;
  pendingSteps?: string[];
  steps?: Record<string, "running" | "complete" | "failed">;
  complete?: boolean;
};
export type AnnouncementTransport = {
  read: (path: string) => Promise<unknown | undefined>;
  write: (
    method: "POST" | "PUT",
    path: string,
    body: Record<string, unknown>,
  ) => Promise<void>;
};
const row = z.record(z.string(), z.unknown());
const rows = z.array(row);
const audioSchema = z.object({
  "file-script-text": z.string(),
  "text-to-speech-voice-id": z.string(),
  "text-to-speech-language": z.string(),
  "file-duration-seconds": z.coerce.number().positive(),
});

// Only called for a domain owned by this provisioning workflow. Every write has a
// durable intent and a read-back; a timeout cannot silently duplicate a resource.
export async function provisionCompanyAnnouncement(
  domain: string,
  state: AnnouncementProgress,
  api: AnnouncementTransport,
  save: (step: string) => Promise<void>,
) {
  if (!/^[1-9]\d*$/.test(domain))
    throw new Error("Invalid announcement domain.");
  const a = companyAnnouncement,
    base = `/domains/${domain}`,
    userPath = `${base}/users/${a.user}`;
  const script = inventoryAnnouncementText(
    z.string().trim().min(2).max(100).parse(state.companyName),
  );
  state.pendingSteps = [
    ...new Set([
      ...(state.pendingSteps ?? []),
      ...(state.pending ? [state.pending] : []),
    ]),
  ];
  delete state.pending;
  state.steps ??= {};
  state.complete = false;
  const clearPending = (key: string) => {
    state.pendingSteps = state.pendingSteps!.filter((item) => item !== key);
  };
  const independent = ["announcement-greeting", "announcement-user-name"];
  async function ensure(
    key: string,
    check: () => Promise<boolean>,
    write: () => Promise<void>,
    group: string[] = [],
  ) {
    state.steps![key] = "running";
    await save(key);
    try {
      if (await check()) {
        clearPending(key);
        state.steps![key] = "complete";
        await save(key);
        return;
      }
      const blocked = state.pendingSteps!.find(
        (item) => item === key || !group.includes(item),
      );
      if (blocked)
        throw new Error(
          `The previous ${blocked} request is not yet confirmed. Resume to verify it; no duplicate request was sent.`,
        );
      state.pendingSteps!.push(key);
      await save(key);
      try {
        await write();
      } catch (error) {
        if (error instanceof NetsapiensCreateRejected) {
          clearPending(key);
          await save(key);
        }
        throw error;
      }
      let confirmed = await check();
      // 202 responses may precede visibility. Poll reads only; never replay writes.
      for (let attempt = 0; !confirmed && attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        confirmed = await check();
      }
      if (!confirmed)
        throw new Error(
          `${key} is not visible yet. Resume to verify the saved request.`,
        );
      clearPending(key);
      state.steps![key] = "complete";
      await save(key);
    } catch (error) {
      state.steps![key] = "failed";
      await save(key);
      throw error;
    }
  }
  let attendant: Record<string, unknown> | undefined;
  const readAttendant = async () => {
    const all = rows.parse(await api.read(base + "/autoattendants"));
    const matches = all.filter((r) => r.user === a.user);
    if (matches.length > 1)
      throw new Error(
        "Extension 9999 has multiple auto attendants. Review it before continuing.",
      );
    attendant = matches[0];
    if (!attendant) {
      if (!state.pendingSteps!.length && (await api.read(userPath)))
        throw new Error(
          "Extension 9999 is already in use. It has not been changed.",
        );
      return false;
    }
    if (!state.created && !state.pendingSteps!.includes("auto-attendant"))
      throw new Error(
        "Extension 9999 already has an auto attendant. It has not been changed.",
      );
    if (
      attendant["attendant-name"] !== a.name ||
      !/^Prompt_\d+$/.test(String(attendant["starting-prompt"]))
    )
      throw new Error(
        "Auto attendant 9999 does not match the saved provisioning request.",
      );
    state.created = true;
    return true;
  };
  await ensure("auto-attendant", readAttendant, async () => {
    await api.write("POST", base + "/autoattendants", {
      "attendant-name": a.name,
      user: a.user,
      "time-frame": a.timeframe,
      "auto-attendant": announcementMenuDefaults,
    });
  });
  state.created = true;
  await save("auto-attendant");
  const prompt = String(attendant!["starting-prompt"]);
  const user = row.parse(await api.read(userPath));
  if (
    user.domain !== domain ||
    user.user !== a.user ||
    user["dial-plan"] !== `${domain}_${a.user}`
  )
    throw new Error(
      "Auto attendant 9999 ownership or dial plan could not be verified.",
    );
  const plan = `${base}/dialplans/${domain}_${a.user}/dialrules`;
  // 44.4 can leave omitted menu actions empty. That attendant appears in the
  // list but the Manager Portal redirects away from its editor. Read back the
  // documented defaults and repair only empty actions on our owned attendant.
  let menuDetail: Record<string, unknown> | undefined;
  let menuPath = "";
  await ensure(
    "announcement-menu",
    async () => {
      const answer = row.parse(await api.read(userPath + "/answerrules/*"));
      const forward = z
        .object({
          enabled: z.literal("yes"),
          parameters: z.array(z.string()).length(1),
        })
        .parse(answer["forward-always"]);
      const entry = forward.parameters[0];
      if (entry !== prompt && entry !== `Announce_${a.greetingIndex}`)
        throw new Error(
          "The attendant entry point changed outside provisioning. It has not been overwritten.",
        );
      menuPath = `${userPath}/autoattendants/${entry}`;
      menuDetail = row.parse(await api.read(menuPath));
      if (menuDetail.user !== a.user || menuDetail["attendant-name"] !== a.name)
        throw new Error("The attendant menu ownership could not be verified.");
      const menu = row.parse(menuDetail["auto-attendant"]);
      for (const key of Object.keys(announcementMenuDefaults))
        if (menu[key] !== "" && menu[key] !== "repeat")
          throw new Error(
            "The attendant menu differs from the standard defaults. It has not been overwritten.",
          );
      return Object.keys(announcementMenuDefaults).every(
        (key) => menu[key] === "repeat",
      );
    },
    () =>
      api.write("PUT", menuPath, {
        "attendant-name": a.name,
        "auto-attendant": {
          ...row.parse(menuDetail!["auto-attendant"]),
          ...announcementMenuDefaults,
        },
      }),
  );
  const greetingPath = `${userPath}/greetings/${a.greetingIndex}`;
  function verifyAudio(value: unknown) {
    const audio = audioSchema.parse(value);
    if (
      audio["file-script-text"] !== script ||
      audio["text-to-speech-voice-id"] !== a.voice ||
      audio["text-to-speech-language"] !== a.language
    )
      throw new Error(
        "The company announcement greeting or voice differs from the saved request. It has not been overwritten.",
      );
  }
  let initialRules: Record<string, unknown>[] = [];
  // Speech generation/upload can overlap naming the owned extension and reading
  // its routing plan. Routing writes and activation still wait for verified audio.
  await concurrentWork(
    [
      async () =>
        ensure(
          "announcement-greeting",
          async () => {
            const greeting = await api.read(greetingPath);
            if (!greeting) return false;
            verifyAudio(greeting);
            return true;
          },
          () =>
            api.write("POST", userPath + "/greetings", {
              synchronous: "yes",
              index: a.greetingIndex,
              script,
              voice_id: a.voice,
              voice_language: a.language,
            }),
          independent,
        ),
      async () =>
        ensure(
          "announcement-user-name",
          async () => {
            const subscriber = row.parse(await api.read(userPath));
            if (
              subscriber.domain !== domain ||
              subscriber.user !== a.user ||
              subscriber["dial-plan"] !== `${domain}_${a.user}`
            )
              throw new Error(
                "Auto attendant user ownership could not be verified.",
              );
            return (
              subscriber["name-first-name"] === a.name &&
              subscriber["name-last-name"] === "Announcement"
            );
          },
          () =>
            api.write("PUT", userPath, {
              "name-first-name": a.name,
              "name-last-name": "Announcement",
            }),
          independent,
        ),
      async () => {
        initialRules = rows.parse(await api.read(plan));
      },
    ],
    3,
    (task) => task(),
  );
  const announce = `Announce_${a.greetingIndex}`;
  // This is the same Intro Greetings routing used by the RingLogix portal:
  // Default answer rule -> Announce_<index> -> original menu prompt.
  for (const [key, match, application, destination] of [
    ["announcement-route", announce, "Announce", String(a.greetingIndex)],
    [
      "announcement-return",
      announce + ".Done",
      "Prompt",
      prompt.slice("Prompt_".length),
    ],
  ] as const) {
    const body = {
      "dial-rule-matching-to-uri": match,
      "dial-rule-application": application,
      "dial-rule-translation-destination-user": destination,
      "dial-rule-translation-destination-host": domain,
      "dial-rule-translation-destination-scheme": "sip:",
      "dial-rule-translation-source-scheme": "sip:",
      enabled: "yes",
      "dial-rule-description": `AA designer: ${a.name}`,
    };
    let firstLookup = true;
    await ensure(
      key,
      async () => {
        const current = firstLookup
          ? initialRules
          : rows.parse(await api.read(plan));
        firstLookup = false;
        const matches = current.filter(
          (r) => r["dial-rule-matching-to-uri"] === match,
        );
        if (!matches.length) return false;
        if (
          matches.length !== 1 ||
          matches[0]!.domain !== domain ||
          String(matches[0]!["dial-rule-dial-plan"]) !==
            `${domain}_${a.user}` ||
          Object.entries(body).some(([k, v]) => String(matches[0]![k]) !== v)
        )
          throw new Error(
            "The announcement routing differs from the saved request. It has not been overwritten.",
          );
        return true;
      },
      () => api.write("POST", plan, { synchronous: "yes", ...body }),
    );
  }
  const answerPath = userPath + "/answerrules/*";
  await ensure(
    "announcement-activation",
    async () => {
      const answer = row.parse(await api.read(answerPath));
      if (
        answer.domain !== domain ||
        answer.user !== a.user ||
        answer["time-frame"] !== "*" ||
        answer.enabled !== "yes"
      )
        throw new Error(
          "The default auto attendant answer rule could not be verified.",
        );
      const forward = z
        .object({ enabled: z.string(), parameters: z.array(z.string()) })
        .parse(answer["forward-always"]);
      if (
        forward.enabled === "yes" &&
        forward.parameters.length === 1 &&
        forward.parameters[0] === announce
      )
        return true;
      if (
        forward.enabled !== "yes" ||
        forward.parameters.length !== 1 ||
        forward.parameters[0] !== prompt
      )
        throw new Error(
          "The default answer rule was changed outside provisioning. It has not been overwritten.",
        );
      return false;
    },
    () =>
      api.write("PUT", answerPath, {
        enabled: "yes",
        "is-active": true,
        "forward-always": { enabled: "yes", parameters: [announce] },
      }),
  );
  state.steps!["announcement-verification"] = "running";
  await save("announcement-verification");
  const detail = row.parse(
    await api.read(`${userPath}/autoattendants/${announce}`),
  );
  if (
    detail.user !== a.user ||
    detail["attendant-name"] !== a.name ||
    detail["time-frame"] !== "*"
  )
    throw new Error("The company auto attendant could not be verified.");
  const intros = rows
    .parse(detail["intro-greetings"])
    .filter((g) => g["time-frame"] === "*");
  if (intros.length !== 1)
    throw new Error("The Default intro greeting could not be verified.");
  verifyAudio(intros[0]!.audio);
  state.complete = true;
  state.steps!["announcement-verification"] = "complete";
  await save("announcement-verification");
}
