import { action, type Context, field, form, Icons, type Item, list, meta, pop, submenu, toast } from "@backslash/api";
import { type Chat, chatOf } from "../api.ts";
import {
  AVAILABILITY,
  type CurrentStatus,
  dndEnd,
  emojiName,
  MM_DURATIONS,
  type MmDuration,
  type Preset,
  untilText,
} from "../lib.ts";
import { live, notifyChanged } from "../live.ts";
import { guarded } from "../views.ts";

const DND = ["30 minutes", "1 hour", "2 hours", "4 hours", "until tomorrow", "Don't clear"];

async function done(message: string) {
  notifyChanged();
  await toast(message, { style: "success" });
}

function customForm(chat: Chat) {
  const mattermost = chat.id === "mattermost";
  return form({
    title: `Custom ${chat.name} status`,
    submitTitle: "Set Status",
    fields: [
      field.text("text", "Status", { required: true, placeholder: "What's happening?" }),
      ...(mattermost
        ? [
          field.text("emoji", "Emoji", {
            placeholder: "speech_balloon, palm_tree, :coffee:…",
            value: "speech_balloon",
          }),
          field.dropdown("duration", "Clear after", MM_DURATIONS, { value: "today" }),
        ]
        : []),
    ],
    async submit(values) {
      const text = String(values.text ?? "").trim();
      if (!text) throw new Error("Type a status");
      const max = mattermost ? 100 : 60;
      if (text.length > max) throw new Error(`A status has ${max} characters at most`);
      const emoji = mattermost ? emojiName(String(values.emoji ?? "")) || "speech_balloon" : "";
      await chat.setCustom(text, emoji, String(values.duration ?? "") as MmDuration);
      await done(`Status set: ${text}`);
      return pop();
    },
  });
}

function presetItem(chat: Chat, p: Preset, current: CurrentStatus): Item {
  const active = current.custom?.text === p.title;
  const mattermost = chat.id === "mattermost";
  const durations = mattermost
    ? submenu(
      "Set for…",
      MM_DURATIONS.map((d) =>
        action(d.value ? `For ${d.title.toLowerCase()}` : "Don't Clear", async () => {
          await chat.setCustom(p.title, p, d.value);
          await done(`${p.title}${d.value ? ` · ${d.title.toLowerCase()}` : ""}`);
        }, { icon: Icons.clock })
      ),
      { icon: Icons.clock, shortcut: "<Ctrl>d" },
    )
    : undefined;
  const length = MM_DURATIONS.find((d) => d.value === p.duration)?.title.toLowerCase();
  return {
    id: `preset-${p.id}`,
    title: p.title,
    subtitle: mattermost && length ? `clears after ${length}` : undefined,
    icon: p.glyph,
    section: "Custom Status",
    accessories: active ? [{ tag: "Current", color: "green" }] : [],
    actions: [
      action(`Set “${p.title}”`, async () => {
        await chat.setCustom(p.title, p, p.duration);
        await done(`${p.title}${mattermost && length ? ` · ${length}` : ""}`);
      }, { icon: Icons.check }),
      ...(durations ? [durations] : []),
    ],
  };
}

function availabilityItems(chat: Chat, current: CurrentStatus): Item[] {
  if (!chat.setAvailability) return [];
  return AVAILABILITY.map((a) => {
    const active = current.availability === a.value;
    const set = (end?: number) => async () => {
      await chat.setAvailability!(a.value, end);
      await done(`${a.title}${end ? ` ${untilText(end * 1000)}` : ""}`);
    };
    return {
      id: `availability-${a.value}`,
      title: a.title,
      subtitle: active && a.value === "dnd" && current.dndEnd ? untilText(current.dndEnd * 1000) : undefined,
      icon: { source: Icons.dot, tint: a.color },
      section: "Availability",
      accessories: active ? [{ tag: "Current", color: "green" as const }] : [],
      actions: a.value === "dnd"
        ? [
          action("Do Not Disturb for 1 Hour", set(dndEnd("1 hour")), { icon: Icons.bellOff }),
          submenu(
            "Do Not Disturb for…",
            DND.map((d) =>
              action(
                d === "Don't clear" ? "Don't Clear" : `For ${d}`.replace("For until", "Until"),
                set(dndEnd(d) || undefined),
                {
                  icon: Icons.clock,
                },
              )
            ),
            { icon: Icons.clock, shortcut: "<Ctrl>d" },
          ),
        ]
        : [action(`Set ${a.title}`, set(), { icon: Icons.check })],
    };
  });
}

export default (ctx: Context) =>
  list({
    placeholder: "Pick a status…",
    status: (items) => items[0]?.id === "setup" ? "Not connected" : "",
    items: ({ signal }) =>
      live(() =>
        guarded(async () => {
          const chat = chatOf(ctx.preferences);
          const current = await chat.status(signal).catch((e) => {
            if (signal.aborted) throw e;
            return {} as CurrentStatus;
          });
          const custom = current.custom;
          const now: Item[] = custom
            ? [{
              id: "current",
              title: custom.text || custom.emoji,
              subtitle: custom.expires ? untilText(custom.expires) : "until you clear it",
              icon: { source: Icons.comment, tint: "blue" },
              section: "Now",
              detail: {
                markdown: `### ${custom.text}`,
                metadata: [
                  meta.text("Emoji", `:${custom.emoji}:`),
                  ...(custom.expires ? [meta.text("Clears", untilText(custom.expires), { icon: Icons.clock })] : []),
                ],
              },
              actions: [action("Clear Status", async () => {
                await chat.clearCustom();
                await done("Status cleared");
              }, { icon: Icons.cross })],
            }]
            : [];
          return [
            ...now,
            ...availabilityItems(chat, current),
            ...chat.presets.map((p) => presetItem(chat, p, current)),
            {
              id: "custom",
              title: "Custom Status…",
              subtitle: "Your own words",
              icon: { source: Icons.plus, tint: "green" },
              section: "Custom Status",
              actions: [action("Write a Status…", () => customForm(chat), { icon: Icons.text })],
            },
            {
              id: "clear",
              title: "Clear Status",
              icon: { source: Icons.cross, tint: "gray" },
              section: "Custom Status",
              actions: [action("Clear Status", async () => {
                await chat.clearCustom();
                await done("Status cleared");
              }, { icon: Icons.cross })],
            },
          ];
        }), signal),
  });
