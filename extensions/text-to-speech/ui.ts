// Speaking from any command, the empty state, and voice items.

import { action, close, type Context, Icons, type Item, meta, refresh, updateCommandMetadata } from "@backslash/api";
import {
  cleanText,
  clock,
  duration,
  type Engine,
  ENGINE_NAMES,
  installMarkdown,
  parseEngine,
  pickEngine,
  preview,
  speedOf,
  type Voice,
} from "./lib.ts";
import { engines, family, type Prefs, speak, stop } from "./system.ts";

export const prefsOf = (ctx: Context) => ctx.preferences as Prefs;

export class NoEngine extends Error {}

/** The engine to use: the preference, else the first installed one. */
export async function engineFor(
  prefs: Prefs,
): Promise<{ engine?: Engine; available: Set<Engine>; piperWithoutModel: boolean }> {
  const found = await engines(prefs);
  return { ...found, engine: pickEngine(parseEngine(prefs.engine), found.available) };
}

/** Speaks and describes it: "Speaking with eSpeak NG (French)…". Throws NoEngine with what to install. */
export async function say(text: string, prefs: Prefs): Promise<string> {
  const clean = cleanText(text);
  if (!clean) throw new Error("Nothing to read: the text is empty");
  const { engine, piperWithoutModel } = await engineFor(prefs);
  if (!engine) {
    const wanted = parseEngine(prefs.engine);
    throw new NoEngine(
      wanted !== "auto"
        ? `${ENGINE_NAMES[wanted]} is not installed${wanted === "piper" && piperWithoutModel ? " or has no voice" : ""}`
        : "No speech engine installed: install espeak-ng",
    );
  }
  const spoken = await speak(clean, engine, prefs, speedOf(prefs.speed));
  updateCommandMetadata({ subtitle: `Speaking… ${preview(clean, 40)}` }).catch(() => {});
  const who = spoken.voice ? spoken.voice.name : spoken.language ? spoken.language.toUpperCase() : ENGINE_NAMES[engine];
  return `Speaking with ${ENGINE_NAMES[engine]} · ${who}`;
}

/** An action that speaks the text and hides the launcher. */
export const speakAction = (title: string, text: () => Promise<string> | string, prefs: Prefs, shortcut?: string) =>
  action(title, async () => close(await say(await text(), prefs)), { icon: Icons.speaker, shortcut });

export const stopAction = () =>
  action("Stop Speaking", async () => {
    await stop();
    updateCommandMetadata({ subtitle: null }).catch(() => {});
    return refresh();
  }, { icon: Icons.stop, shortcut: "<Ctrl>." });

/** "Speak …" with an estimate of how long it takes. */
export function textItem(
  id: string,
  title: string,
  text: string,
  prefs: Prefs,
  section: string,
  icon: string = Icons.text,
): Item {
  const clean = cleanText(text);
  const secs = duration(clean, speedOf(prefs.speed));
  return {
    id,
    title,
    subtitle: preview(clean, 70),
    icon: { source: icon, tint: "blue" },
    section,
    accessories: [{ text: `~${clock(secs)}`, tooltip: "Estimated reading time" }],
    detail: {
      markdown: clean.length > 4000 ? `${clean.slice(0, 4000)}…` : clean,
      metadata: [
        meta.text("Words", (clean.match(/[\p{L}\p{N}]+/gu) ?? []).length),
        meta.text("Reading time", `about ${clock(secs)}`, { icon: Icons.clock }),
        meta.text("Speed", `${Math.round(speedOf(prefs.speed) * 100)} %`, { icon: Icons.bolt }),
      ],
    },
    actions: [speakAction(title, () => text, prefs)],
  };
}

export async function installItem(piperWithoutModel: boolean): Promise<Item> {
  const fam = await family();
  return {
    id: "install",
    title: piperWithoutModel ? "Piper has no voice yet" : "No speech engine installed",
    subtitle: piperWithoutModel
      ? "Add a voice model to ~/.local/share/piper, or install espeak-ng"
      : "Install espeak-ng to start",
    icon: { source: Icons.alert, tint: "orange" },
    detail: { markdown: installMarkdown(fam) },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}

export function voiceItem(v: Voice, active: boolean, onChoose: () => Promise<void>, prefs: Prefs): Item {
  const sample = v.language.startsWith("fr")
    ? "Bonjour ! Voici à quoi ressemble cette voix."
    : v.language.startsWith("de")
    ? "Hallo! So klingt diese Stimme."
    : v.language.startsWith("es")
    ? "¡Hola! Así suena esta voz."
    : "Hello! This is what this voice sounds like.";
  return {
    id: `${v.engine}:${v.id}`,
    title: v.name,
    subtitle: v.language,
    icon: { source: Icons.speaker, tint: active ? "green" : "gray" },
    section: ENGINE_NAMES[v.engine],
    keywords: [v.language, v.engine, v.gender ?? "", v.quality ?? ""],
    accessories: [
      ...(active ? [{ tag: "Default", color: "green" as const }] : []),
      ...(v.quality ? [{ text: v.quality }] : []),
      ...(v.gender ? [{ text: v.gender }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Engine", ENGINE_NAMES[v.engine], { icon: Icons.speaker }),
        meta.text("Language", v.language, { icon: Icons.globe }),
        ...(v.gender ? [meta.text("Gender", v.gender)] : []),
        ...(v.quality ? [meta.text("Quality", v.quality)] : []),
        ...(v.sampleRate ? [meta.text("Sample rate", `${v.sampleRate} Hz`)] : []),
        meta.text(v.engine === "piper" ? "Model" : "Voice", v.id, { icon: Icons.file }),
      ],
    },
    actions: [
      action(active ? "Default Voice" : "Use This Voice", async () => {
        await onChoose();
        return refresh();
      }, { icon: Icons.check }),
      speakAction("Preview Voice", () => sample, { ...prefs, engine: v.engine, voice: v.id }, "<Ctrl>p"),
    ],
  };
}
