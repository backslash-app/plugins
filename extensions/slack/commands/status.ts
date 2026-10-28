import {
  type Action,
  action,
  type Context,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  pop,
  submenu,
  updateCommandMetadata,
} from "@backslash/api";
import { clearStatus, done, endSnooze, getDnd, getStatus, setStatus, setStatusFor, snooze, tokenOf } from "../api.ts";
import {
  clock,
  type Duration,
  DURATIONS,
  durationTitle,
  emojiCode,
  emojiOf,
  expiryFor,
  guarded,
  type Preset,
  PRESETS,
  snoozeMinutes,
  type Status,
  statusSubtitle,
  untilText,
} from "../lib.ts";
import { live, notifyChanged } from "../live.ts";

const SNOOZES = ["30 minutes", "1 hour", "2 hours", "until tomorrow"];

function customForm(token: string, initial: Partial<Status> & { duration?: Duration } = {}) {
  return form({
    title: "Custom Slack status",
    submitTitle: "Set Status",
    fields: [
      field.text("text", "Status", { placeholder: "What's happening?", value: initial.text ?? "" }),
      field.text("emoji", "Emoji", {
        placeholder: ":speech_balloon: or a code like palm_tree",
        value: initial.emoji ?? ":speech_balloon:",
      }),
      field.dropdown("duration", "Clear after", DURATIONS, { value: initial.duration ?? "today" }),
      field.checkbox("dnd", "Pause notifications as long (up to 1 day)", { value: false }),
    ],
    async submit(values) {
      const text = String(values.text ?? "").trim();
      const emoji = emojiCode(String(values.emoji ?? "")) || (text ? ":speech_balloon:" : "");
      if (!text && !emoji) throw new Error("Type a status or an emoji");
      if (text.length > 100) throw new Error("A status has 100 characters at most");
      const duration = String(values.duration) as Duration;
      const status = await setStatusFor(token, { text, emoji }, duration);
      if (values.dnd) await pauseAlong(token, status.expiration);
      notifyChanged();
      await done(`Status set ${untilText(status.expiration)}`);
      return pop();
    },
  });
}

/** Do Not Disturb until the status clears, at most a day (Slack's limit for a snooze). */
async function pauseAlong(token: string, expiration: number) {
  const minutes = expiration > 0 ? Math.round((expiration * 1000 - Date.now()) / 60_000) : 24 * 60;
  await snooze(token, Math.max(1, Math.min(minutes, 24 * 60)));
}

async function applyPreset(token: string, preset: Preset, duration: Duration) {
  const status = await setStatusFor(token, { text: preset.text, emoji: preset.emoji }, duration);
  if (preset.dnd) await pauseAlong(token, status.expiration);
  notifyChanged();
  await done(`${preset.title} ${untilText(status.expiration)}${preset.dnd ? " · notifications paused" : ""}`);
}

function presetItem(token: string, preset: Preset, current: Status): Item {
  const active = current.text === preset.text && current.emoji === preset.emoji;
  const forDuration = (d: Duration) =>
    action(d === "never" ? "Don't Clear" : `For ${durationTitle(d)}`, () => applyPreset(token, preset, d), {
      icon: Icons.clock,
    });
  const expires = expiryFor(preset.duration);
  return {
    id: `preset:${preset.id}`,
    title: preset.title,
    subtitle: `${emojiOf(preset.emoji)} ${preset.text}`,
    icon: preset.icon,
    section: "Presets",
    keywords: [preset.text, preset.emoji.replaceAll(":", "")],
    accessories: [
      ...(active ? [{ tag: "Current", color: "green" as const }] : []),
      ...(preset.dnd ? [{ icon: Icons.bellOff, tooltip: "Also pauses notifications" }] : []),
      { text: durationTitle(preset.duration), tooltip: "Clears after" },
    ],
    detail: {
      markdown: `## ${emojiOf(preset.emoji)} ${preset.text}`,
      metadata: [
        meta.text("Emoji", preset.emoji),
        meta.text("Clears", expires ? untilText(expires) : "Never", { icon: Icons.clock }),
        meta.text("Notifications", preset.dnd ? "Paused as long" : "Unchanged", {
          icon: preset.dnd ? Icons.bellOff : Icons.bell,
        }),
      ],
    },
    actions: [
      action(`Set “${preset.title}”`, () => applyPreset(token, preset, preset.duration), { icon: Icons.check }),
      submenu("Set For…", DURATIONS.map((d) => forDuration(d.value)), {
        icon: Icons.clock,
        shortcut: "<Ctrl>d",
      }),
      action(
        "Customize…",
        () => customForm(token, { text: preset.text, emoji: preset.emoji, duration: preset.duration }),
        {
          icon: Icons.settings,
          shortcut: "<Ctrl>e",
        },
      ),
    ],
  };
}

function currentItem(token: string, status: Status): Item {
  if (!status.text && !status.emoji) {
    return {
      id: "current",
      title: "No status",
      subtitle: "Pick a preset or write your own",
      icon: { source: Icons.smile, tint: "gray" },
      section: "Current",
      actions: [action("Custom Status…", () => customForm(token), { icon: Icons.plus })],
    };
  }
  return {
    id: "current",
    title: status.text || emojiOf(status.emoji),
    subtitle: untilText(status.expiration),
    // The user's own status emoji.
    icon: emojiOf(status.emoji).startsWith(":") ? { source: Icons.smile, tint: "green" } : emojiOf(status.emoji),
    section: "Current",
    accessories: [{ tag: "Current", color: "green" }],
    detail: {
      markdown: `## ${emojiOf(status.emoji)} ${status.text}`,
      metadata: [
        meta.text("Emoji", status.emoji || "None"),
        meta.text("Clears", status.expiration ? untilText(status.expiration) : "Never", { icon: Icons.clock }),
      ],
    },
    actions: [
      action("Clear Status", async () => {
        await clearStatus(token);
        notifyChanged();
        await done("Status cleared");
      }, { icon: Icons.cross }),
      action("Edit Status…", () => customForm(token, status), { icon: Icons.settings, shortcut: "<Ctrl>e" }),
    ],
  };
}

function dndItems(token: string, snoozedUntil: number | undefined): Item[] {
  const items: Item[] = [];
  if (snoozedUntil) {
    items.push({
      id: "dnd:active",
      title: "Notifications paused",
      subtitle: `until ${clock(snoozedUntil)}`,
      icon: { source: Icons.bellOff, tint: "purple" },
      section: "Do Not Disturb",
      accessories: [{ tag: "On", color: "purple" }],
      actions: [
        action("Resume Notifications", async () => {
          await endSnooze(token);
          notifyChanged();
          await done("Notifications resumed");
        }, { icon: Icons.bell }),
      ],
    });
  }
  for (const choice of SNOOZES) {
    items.push({
      id: `dnd:${choice}`,
      title: `Pause notifications ${/^until/.test(choice) ? choice : `for ${choice}`}`,
      subtitle: /tomorrow/.test(choice) ? "Until 9:00 tomorrow" : undefined,
      icon: { source: Icons.bellOff, tint: "gray" },
      section: "Do Not Disturb",
      keywords: ["dnd", "do not disturb", "snooze", "mute"],
      actions: [
        action("Pause Notifications", async () => {
          const end = await snooze(token, snoozeMinutes(choice));
          notifyChanged();
          await done(`Notifications paused until ${clock(end)}`);
        }, { icon: Icons.bellOff }),
      ],
    });
  }
  return items;
}

export default (ctx: Context) => {
  const typed = ctx.query.trim();
  return list({
    placeholder: "Pick a status…",
    status: (items) => items[0]?.id === "setup" ? "Not connected" : "Enter sets the status · Ctrl+D picks how long",
    items: ({ signal }) =>
      live(() =>
        guarded(async () => {
          const token = tokenOf(ctx);
          const [status, dnd] = await Promise.all([
            getStatus(token, signal),
            getDnd(token, signal).catch(() => undefined),
          ]);
          const snoozedUntil = dnd?.snooze_enabled && dnd.snooze_endtime ? dnd.snooze_endtime : undefined;
          updateCommandMetadata({
            subtitle: statusSubtitle(status) ??
              (snoozedUntil ? `Notifications paused until ${clock(snoozedUntil)}` : null),
          }).catch(() => {});
          const custom: Action = action("Custom Status…", () => customForm(token, typed ? { text: typed } : {}), {
            icon: Icons.plus,
            shortcut: "<Ctrl>n",
          });
          const head: Item[] = typed
            ? [{
              id: "typed",
              title: `Set status “${typed}”`,
              subtitle: "Clears at the end of the day",
              icon: { source: Icons.comment, tint: "blue" },
              section: "Current",
              actions: [
                action("Set Status", async () => {
                  await setStatus(token, { text: typed, emoji: ":speech_balloon:", expiration: expiryFor("today") });
                  notifyChanged();
                  await done("Status set until tonight");
                }, { icon: Icons.check }),
                action("Customize…", () => customForm(token, { text: typed }), { icon: Icons.settings }),
              ],
            }]
            : [];
          return [
            ...head,
            currentItem(token, status),
            ...PRESETS.map((p) => presetItem(token, p, status)),
            {
              id: "custom",
              title: "Custom Status…",
              subtitle: "Your text, emoji and when it clears",
              icon: { source: Icons.plus, tint: "blue" },
              section: "Presets",
              actions: [custom],
            },
            ...dndItems(token, snoozedUntil),
          ];
        }), signal),
  });
};
