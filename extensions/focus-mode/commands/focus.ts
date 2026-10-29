import {
  action,
  close,
  type Color,
  type Context,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  clockTime,
  countdown,
  DND_NAMES,
  type DndBackend,
  humanize,
  minutesOf,
  progress,
  type Session,
  today,
} from "../lib.ts";
import {
  blockedNow,
  current,
  dndBackend,
  dndOn,
  extend,
  history,
  type Options,
  optionsOf,
  start,
  stop,
} from "../system.ts";

const PRESETS: [number, string, Color, string][] = [
  [25, "Pomodoro", "red", "25 minutes of focus, then a five-minute break"],
  [50, "Deep Work", "purple", "50 minutes: long enough for a hard problem"],
  [90, "Flow Block", "blue", "90 minutes, one ultradian cycle"],
  [15, "Quick Sprint", "teal", "A quarter of an hour for one small thing"],
];

async function begin(ctx: Context, o: Options) {
  const { session, warnings } = await start(ctx, o);
  if (warnings.length) await toast(warnings[0], { style: "failure", message: warnings.slice(1).join(" · ") });
  return close(`Focus until ${clockTime(session.ends)}`);
}

function what(o: Options): string[] {
  return [
    o.dnd ? "Do Not Disturb" : "",
    o.block && o.sites.length ? `${o.sites.length} sites blocked` : "",
    o.slack ? "Slack status" : "",
  ].filter(Boolean);
}

function customForm(ctx: Context): FormSpec {
  const o = optionsOf(ctx);
  return form({
    title: "New Focus Session",
    submitTitle: "Start Focus",
    fields: [
      field.text("minutes", "Minutes", { value: String(o.minutes), required: true, placeholder: "25" }),
      field.checkbox("dnd", "Turn on Do Not Disturb", { value: o.dnd }),
      field.checkbox("block", `Block ${o.sites.length} distracting sites (asks for your password)`, {
        value: o.block,
      }),
      ...(o.slack ? [field.checkbox("slack", "Set my Slack status and pause Slack", { value: true })] : []),
    ],
    async submit(values, c) {
      const minutes = minutesOf(values.minutes, 0);
      if (!minutes) {
        await toast("Type a number of minutes, 1 to 480", { style: "failure" });
        return;
      }
      return await begin(c, {
        ...o,
        minutes,
        dnd: !!values.dnd,
        block: !!values.block,
        slack: o.slack && !!values.slack,
      });
    },
  });
}

function presetItems(ctx: Context): Item[] {
  const o = optionsOf(ctx);
  const doing = what(o);
  const def = o.minutes;
  const presets = PRESETS.some(([m]) => m === def)
    ? PRESETS
    : [[def, "Focus", "green", "Your default length"] as (typeof PRESETS)[number], ...PRESETS];
  return [
    ...presets.map(([minutes, name, color, about]): Item => ({
      id: `preset:${minutes}`,
      title: `${name}`,
      subtitle: humanize(minutes * 60),
      icon: { source: Icons.play, tint: color },
      section: "Start",
      keywords: [String(minutes), "focus", "start"],
      accessories: minutes === def ? [{ tag: "Default", color: "gray" }] : [],
      detail: {
        stats: [{ label: "length", value: humanize(minutes * 60) }, {
          label: "ends at",
          value: clockTime(Date.now() + minutes * 60_000),
        }],
        markdown: about,
        metadata: [
          meta.tags("During the session", doing.length ? doing : ["Only the timer"]),
          ...(o.block ? [meta.text("Blocked", o.sites.join(", ") || "No site listed", { icon: Icons.shield })] : []),
          meta.text("Ends", "On time even if Backslash is closed (systemd timer)", { icon: Icons.clock }),
        ],
      },
      actions: [
        action(`Focus for ${humanize(minutes * 60)}`, (c) => begin(c, { ...o, minutes }), { icon: Icons.play }),
        action("Custom Session…", (c) => customForm(c), { icon: Icons.settings, shortcut: "<Ctrl>n" }),
      ],
    })),
    {
      id: "custom",
      title: "Custom Session…",
      subtitle: "Any length; pick what to switch off",
      icon: { source: Icons.plus, tint: "gray" },
      section: "Start",
      actions: [action("Custom Session…", (c) => customForm(c), { icon: Icons.plus })],
    },
  ];
}

interface Live {
  dnd?: DndBackend;
  dndState?: boolean;
  blocked: string[];
}

function runningItems(s: Session, live: Live): Item[] {
  const left = Math.max(0, (s.ends - Date.now()) / 1000);
  const p = progress(s);
  const color: Color = left < 120 ? "orange" : "purple";
  const stopAction = action("Stop Session", async (ctx) => {
    const { warnings } = await stop(ctx);
    if (warnings.length) await toast(warnings[0], { style: "failure", message: warnings.slice(1).join(" · ") });
    await updateCommandMetadata({ subtitle: null }).catch(() => {});
    return refresh();
  }, {
    icon: Icons.stop,
    destructive: true,
    confirm: "End the focus session now?",
    shortcut: "<Ctrl>k",
  });
  const more = (m: number) =>
    action(`Add ${m} Minutes`, async (ctx) => {
      const { session, warnings } = await extend(ctx, m);
      await toast(warnings[0] ?? `Focus until ${clockTime(session.ends)}`, {
        style: warnings.length ? "failure" : "success",
      });
      return refresh();
    }, { icon: Icons.plus, shortcut: m === 5 ? "<Ctrl>5" : "<Ctrl>e", section: "Extend" });
  const actions = [stopAction, more(15), more(5)];
  const items: Item[] = [{
    id: "running",
    title: `${countdown(left)} left`,
    subtitle: `focus until ${clockTime(s.ends)}`,
    icon: { source: Icons.eyeOff, tint: color },
    section: "Focusing",
    accessories: [{ tag: `${Math.round(p * 100)}%`, color }],
    detail: {
      stats: [
        { label: "left", value: countdown(left), color },
        { label: "ends at", value: clockTime(s.ends) },
      ],
      metadata: [
        meta.progress("Done", p),
        meta.text("Started", clockTime(s.started), { icon: Icons.clock }),
        meta.text("Length", humanize((s.ends - s.started) / 1000), { icon: Icons.timer }),
        meta.text("Ends", "On time even if Backslash is closed", { icon: Icons.bell }),
      ],
    },
    actions,
  }];
  const dndText = s.dnd
    ? `${DND_NAMES[s.dnd]}: ${live.dndState === false ? "turned off since" : "on"}, off at the end`
    : live.dndState
    ? `${live.dnd ? DND_NAMES[live.dnd] : "Notifications"}: already on, left as it is`
    : "Not changed";
  items.push({
    id: "dnd",
    title: "Do Not Disturb",
    subtitle: dndText,
    icon: { source: Icons.bellOff, tint: s.dnd || live.dndState ? "green" : "gray" },
    section: "During This Session",
    actions,
  });
  if (s.blocked?.length) {
    const active = s.blocked.filter((d) => live.blocked.includes(d));
    items.push({
      id: "sites",
      title: "Blocked Sites",
      subtitle: active.length ? `${active.length} blocked until ${clockTime(s.ends)}` : "Not blocked anymore",
      icon: { source: Icons.shield, tint: active.length ? "green" : "orange" },
      section: "During This Session",
      detail: {
        markdown: [
          s.blocked.map((d) => `- ${d}${live.blocked.includes(d) ? "" : " _(not in /etc/hosts)_"}`).join("\n"),
          "",
          "Browsers using DNS over HTTPS (secure DNS) don't read /etc/hosts: turn it off for blocking to work, " +
          "and reload tabs opened before the session.",
        ].join("\n"),
      },
      actions,
    });
  }
  if (s.slack) {
    items.push({
      id: "slack",
      title: "Slack",
      subtitle: [s.slack.status ? "Status set" : "", s.slack.snoozed ? "notifications paused" : ""]
        .filter(Boolean).join(", ") || "Unchanged (see the error when it started)",
      icon: { source: Icons.hash, tint: s.slack.status || s.slack.snoozed ? "green" : "orange" },
      section: "During This Session",
      detail: { markdown: "Both end by themselves with the session; stopping early puts your previous status back." },
      actions,
    });
  }
  return items;
}

async function loadLive(s: Session | undefined): Promise<Live> {
  const dnd = s?.dnd ?? await dndBackend().catch(() => undefined);
  const [dndState, blocked] = await Promise.all([
    dnd ? dndOn(dnd).catch(() => undefined) : Promise.resolve(undefined),
    s?.blocked?.length ? blockedNow() : Promise.resolve([] as string[]),
  ]);
  return { dnd, dndState, blocked };
}

function todayItem(seconds: number, count: number): Item {
  return {
    id: "today",
    title: count ? `${humanize(seconds)} of focus today` : "No focus session today yet",
    subtitle: count ? `${count} session${count === 1 ? "" : "s"}` : undefined,
    icon: { source: Icons.chartUp, tint: count ? "green" : "gray" },
    section: "Today",
  };
}

export default (ctx: Context) =>
  list({
    placeholder: "Focus for…",
    empty: { title: "Nothing matches", icon: Icons.eyeOff },
    status: (items) => {
      const r = items.find((i) => i.id === "running");
      return r ? `Focusing · ${r.subtitle}` : "Ready to focus";
    },
    async *items({ signal }) {
      let s = await current();
      let live = await loadLive(s);
      let lastSubtitle: string | null | undefined;
      let ticks = 0;
      while (!signal.aborted) {
        if (s && s.ends <= Date.now()) {
          s = await current();
          live = await loadLive(s);
        } else if (s && ++ticks % 15 === 0) {
          live = await loadLive(s);
        }
        const t = today(await history());
        const subtitle = s ? `Focusing until ${clockTime(s.ends)}` : null;
        if (subtitle !== lastSubtitle) {
          lastSubtitle = subtitle;
          updateCommandMetadata({ subtitle }).catch(() => {});
        }
        yield s
          ? [...runningItems(s, live), todayItem(t.seconds, t.count)]
          : [...presetItems(ctx), todayItem(t.seconds, t.count)];
        if (!s) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
    },
  });
