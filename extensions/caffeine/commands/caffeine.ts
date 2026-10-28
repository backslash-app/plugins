import {
  action,
  close,
  type Color,
  exec,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { countdown, humanize, parseDuration, parseInhibitors, type Session, subtitle } from "../lib.ts";
import { current, start, stop } from "../caffeine.ts";

const PRESETS: [string, number | undefined, Color][] = [
  ["15 Minutes", 15 * 60, "teal"],
  ["30 Minutes", 30 * 60, "green"],
  ["1 Hour", 60 * 60, "yellow"],
  ["2 Hours", 2 * 60 * 60, "orange"],
  ["Until Turned Off", undefined, "red"],
];

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const begin = (seconds: number | undefined) => async () => {
  await start(seconds);
  return close(seconds ? `Awake for ${humanize(seconds)}` : "Awake until turned off");
};

const custom = form({
  title: "Keep Awake",
  submitTitle: "Start",
  fields: [field.text("duration", "For how long", { placeholder: "45m, 1h30, 3h", required: true })],
  async submit(values) {
    const seconds = parseDuration(String(values.duration));
    if (!seconds) {
      await toast("Not a duration: try 45m, 1h30 or 3h", { style: "failure" });
      return;
    }
    return begin(seconds)();
  },
});

const PREVENTS = meta.tags("Prevents", [
  { text: "Screen dimming", color: "blue" },
  { text: "Screen lock", color: "blue" },
  { text: "Sleep", color: "blue" },
]);

function awakeItem(s: Session, others: string[]): Item {
  const left = s.until === null ? undefined : Math.max(0, (s.until - Date.now()) / 1000);
  const total = s.until === null ? undefined : (s.until - s.started) / 1000;
  const extend = (minutes: number) =>
    action(
      `${minutes >= 60 ? `${minutes / 60} Hour${minutes > 60 ? "s" : ""}` : `${minutes} Minutes`} More`,
      async () => {
        await start((left ?? 0) + minutes * 60);
        return refresh();
      },
      { icon: Icons.plus },
    );
  return {
    id: "awake",
    title: s.until === null ? "Awake until turned off" : `Awake until ${clockTime(s.until)}`,
    subtitle: left === undefined ? "Keeping the computer awake" : `${humanize(left)} left`,
    icon: { source: Icons.coffee, tint: "orange" },
    section: "Now",
    accessories: [left === undefined ? { tag: "On", color: "orange" } : { tag: countdown(left), color: "orange" }],
    detail: {
      stats: [
        {
          label: left === undefined ? "awake" : "left",
          value: left === undefined ? "∞" : countdown(left),
          color: "orange",
        },
        { label: "since", value: clockTime(s.started) },
        ...(s.until !== null ? [{ label: "until", value: clockTime(s.until) }] : []),
      ],
      metadata: [
        ...(left !== undefined && total ? [meta.progress("Elapsed", 1 - left / total)] : []),
        PREVENTS,
        meta.text("Keeps running", "Even when Backslash is closed (systemd user unit)", { icon: Icons.info }),
        ...(others.length ? [meta.tags("Also keeping awake", others)] : []),
      ],
    },
    actions: [
      action("Turn Off", async () => {
        await stop();
        await updateCommandMetadata({ subtitle: null }).catch(() => {});
        return close("Caffeine off: the computer may sleep again");
      }, { icon: Icons.stop, destructive: true, shortcut: "<Ctrl>k" }),
      ...(left !== undefined
        ? [
          submenu("Extend", [extend(15), extend(30), extend(60)], { icon: Icons.plus, shortcut: "<Ctrl>e" }),
          action("Keep Awake Until Turned Off", begin(undefined), { icon: Icons.coffee, section: "Change" }),
        ]
        : []),
    ],
  };
}

function presetItems(s: Session | undefined): Item[] {
  return [
    ...PRESETS.map(([title, seconds, tint]) => ({
      id: `preset:${title}`,
      title,
      subtitle: seconds ? `until ${clockTime(Date.now() + seconds * 1000)}` : "until you turn it off",
      icon: { source: seconds ? Icons.timer : Icons.coffee, tint },
      section: s ? "Change" : "Keep Awake",
      keywords: ["awake", "réveillé", "veille", "sleep", "inhibit", "caffeine", "café"],
      detail: {
        stats: [{ label: "for", value: seconds ? humanize(seconds) : "∞" }],
        markdown: s ? "Replaces the current session." : undefined,
        metadata: [
          ...(seconds ? [meta.text("Ends at", clockTime(Date.now() + seconds * 1000), { icon: Icons.clock })] : []),
          PREVENTS,
        ],
      },
      actions: [
        action(seconds ? `Keep Awake for ${humanize(seconds)}` : "Keep Awake", begin(seconds), { icon: Icons.coffee }),
      ],
    })),
    {
      id: "custom",
      title: "Custom Duration…",
      subtitle: "45m, 1h30, 3h",
      icon: { source: Icons.plus, tint: "gray" },
      section: s ? "Change" : "Keep Awake",
      actions: [action("Custom Duration…", () => custom, { icon: Icons.plus })],
    },
  ];
}

/** Other programs holding an idle or sleep inhibitor (a video, a download…). */
async function otherInhibitors(): Promise<string[]> {
  const out = await exec("systemd-inhibit", ["--list", "--no-legend", "--no-pager"]).catch(() => "");
  return [...new Set(parseInhibitors(out).map((i) => i.who))];
}

export default list({
  placeholder: "Keep the computer awake…",
  empty: { title: "Caffeine", icon: Icons.coffee },
  status: (items) => items.find((i) => i.id === "awake")?.subtitle ?? "The computer sleeps as usual",
  // Live while awake: the countdown ticks every second.
  async *items({ signal }) {
    const others = await otherInhibitors();
    let last: string | null | undefined;
    while (!signal.aborted) {
      const s = await current();
      const sub = subtitle(s);
      if (sub !== last) {
        last = sub;
        updateCommandMetadata({ subtitle: sub }).catch(() => {});
      }
      yield [...(s ? [awakeItem(s, others)] : []), ...presetItems(s)];
      if (!s) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
});
