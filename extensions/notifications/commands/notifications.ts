import {
  type Action,
  action,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Backend, detect } from "../backends.ts";
import { ago, escapeMarkdown, type Notification, plainText } from "../lib.ts";

const URGENCY: Record<Notification["urgency"], [string, Color]> = {
  low: ["Low", "gray"],
  normal: ["Normal", "blue"],
  critical: ["Critical", "red"],
};

const NOT_FOUND = {
  title: "No notification daemon found",
  description: "Backslash works with mako, Dunst, SwayNotificationCenter, GNOME, Plasma, Xfce and Cinnamon",
  icon: Icons.bellOff,
};

function toggleAction(b: Backend, on: boolean): Action {
  return action(on ? "Turn Off Do Not Disturb" : "Turn On Do Not Disturb", async () => {
    await b.setDnd!(!on);
    await updateCommandMetadata({ subtitle: on ? null : "Do Not Disturb" }).catch(() => {});
    await toast(on ? "Notifications are back" : "Do Not Disturb is on", { style: "success" });
    return refresh();
  }, { icon: on ? Icons.bell : Icons.bellOff, shortcut: "<Ctrl>d" });
}

function dndItem(b: Backend, on: boolean | undefined): Item {
  const known = on !== undefined;
  const settings = b.openSettings
    ? [action("Open Notification Settings", async () => {
      await b.openSettings!();
    }, { icon: Icons.settings, section: "Settings" })]
    : [];
  return {
    id: "dnd",
    title: "Do Not Disturb",
    subtitle: !known ? "State unknown" : on ? "On: notifications are silenced" : "Off",
    icon: { source: on ? Icons.bellOff : Icons.bell, tint: on ? "purple" : "gray" },
    section: "Status",
    keywords: ["dnd", "ne pas déranger", "silence", "focus", "mute", "pause"],
    accessories: [
      known ? { tag: on ? "On" : "Off", color: on ? "purple" : "gray" } : { tag: "Unknown", color: "gray" },
    ],
    detail: {
      markdown: b.dndNote,
      metadata: [
        meta.text("Do Not Disturb", !known ? "Unknown" : on ? "On" : "Off", {
          icon: on ? Icons.bellOff : Icons.bell,
          color: on ? "purple" : undefined,
        }),
        meta.text("Handled by", b.version ? `${b.title} ${b.version}` : b.title, { icon: Icons.settings }),
        meta.text("Can be switched here", b.setDnd ? "Yes" : "No", { color: b.setDnd ? "green" : "orange" }),
      ],
    },
    actions: [...(b.setDnd && known ? [toggleAction(b, on)] : []), ...settings],
  };
}

function notificationItem(n: Notification, b: Backend, now: number): Item {
  const summary = plainText(n.summary);
  const body = plainText(n.body);
  const [urgency, color] = URGENCY[n.urgency];
  const all = [summary, body].filter(Boolean).join("\n");
  const run = (title: string, fn: () => Promise<void>, done: string, options = {}) =>
    action(title, async () => {
      await fn();
      await toast(done, { style: "success" });
      return refresh();
    }, options);
  return {
    id: `n:${n.id}:${n.time ?? ""}`,
    title: summary || n.app,
    subtitle: body.split("\n")[0].slice(0, 120) || undefined,
    icon: { source: n.urgency === "critical" ? Icons.alert : Icons.bell, tint: color },
    section: "History",
    keywords: [n.app, body, n.category ?? ""],
    accessories: [
      { tag: n.app, color: "gray" },
      ...(n.time ? [{ text: ago(n.time, now), tooltip: new Date(n.time).toLocaleString() }] : []),
    ],
    detail: {
      markdown: [summary && `**${escapeMarkdown(summary)}**`, body && escapeMarkdown(body).replace(/\n/g, "  \n")]
        .filter(Boolean).join("\n\n"),
      metadata: [
        meta.text("App", n.app, { icon: Icons.apps }),
        ...(n.time ? [meta.text("Received", new Date(n.time).toLocaleString(), { icon: Icons.clock })] : []),
        meta.tags("Urgency", [{ text: urgency, color }]),
        ...(n.category ? [meta.text("Category", n.category, { icon: Icons.tag })] : []),
        meta.text("ID", n.id, { icon: Icons.hash }),
      ],
    },
    actions: [
      copy(all, "Copy Text", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(body ? [copy(body, "Copy Body", { section: "Copy" })] : []),
      ...(summary ? [copy(summary, "Copy Title", { section: "Copy" })] : []),
      ...(b.restore && b.id !== "mako"
        ? [run("Show Again", () => b.restore!(n), "Shown again", { icon: Icons.bell, section: "Notification" })]
        : []),
      ...(b.remove
        ? [run("Remove from History", () => b.remove!(n), "Removed", {
          icon: Icons.trash,
          destructive: true,
          section: "Notification",
          shortcut: "<Ctrl>Delete",
        })]
        : []),
      ...(b.clear
        ? [run(b.clearTitle ?? "Clear", b.clear, "Cleared", {
          icon: Icons.trash,
          destructive: true,
          confirm: `${b.clearTitle ?? "Clear"}? This cannot be undone.`,
          section: "Danger",
        })]
        : []),
    ],
  };
}

/** Explains where the history is when the daemon doesn't share it. */
function noHistoryItem(b: Backend): Item {
  return {
    id: "no-history",
    title: "History not available",
    subtitle: b.title,
    icon: { source: Icons.info, tint: "gray" },
    section: "History",
    detail: { markdown: b.historyNote },
    actions: [
      ...(b.openCenter
        ? [action("Open Notification Center", async () => {
          await b.openCenter!();
        }, { icon: Icons.inbox })]
        : []),
      ...(b.clear
        ? [action(b.clearTitle ?? "Clear", async () => {
          await b.clear!();
          await toast("Cleared", { style: "success" });
        }, { icon: Icons.trash, destructive: true, confirm: `${b.clearTitle ?? "Clear"}?`, section: "Danger" })]
        : []),
      ...(b.openSettings
        ? [action("Open Notification Settings", async () => {
          await b.openSettings!();
        }, { icon: Icons.settings })]
        : []),
    ],
  };
}

export default async () => {
  const b = await detect();
  if (!b) return list({ empty: NOT_FOUND, items: [], status: "No notification daemon" });
  const [on, history] = await Promise.all([
    b.dnd().catch(() => undefined),
    b.history ? b.history().catch((err) => err as Error) : Promise.resolve(undefined),
  ]);
  if (on !== undefined) updateCommandMetadata({ subtitle: on ? "Do Not Disturb" : null }).catch(() => {});

  const now = Date.now();
  const items: Item[] = [dndItem(b, on)];
  if (history instanceof Error) {
    items.push({
      id: "history-error",
      title: "Could not read the history",
      subtitle: history.message.split("\n")[0],
      icon: { source: Icons.alert, tint: "orange" },
      section: "History",
      detail: { markdown: `\`\`\`\n${history.message}\n\`\`\`` },
      actions: [action("Try Again", () => refresh(), { icon: Icons.refresh })],
    });
  } else if (history) {
    // Newest first: dunst and mako already list them that way, timestamps settle it when there are some.
    const sorted = history.some((n) => n.time) ? [...history].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)) : history;
    items.push(...sorted.map((n) => notificationItem(n, b, now)));
    if (!sorted.length) {
      items.push({
        id: "history-empty",
        title: "No notifications yet",
        subtitle: "Dismissed notifications show up here",
        icon: { source: Icons.inbox, tint: "gray" },
        section: "History",
      });
    }
  } else {
    items.push(noHistoryItem(b));
  }

  const count = history && !(history instanceof Error) ? history.length : undefined;
  const actions: Action[] = [
    ...(b.setDnd && on !== undefined ? [toggleAction(b, on)] : []),
    ...(b.openCenter
      ? [action("Open Notification Center", async () => {
        await b.openCenter!();
      }, { icon: Icons.inbox })]
      : []),
    ...(b.id === "mako" && b.restore
      ? [action("Restore Last Notification", async () => {
        await b.restore!({ id: "", app: "", summary: "", body: "", urgency: "normal" });
      }, { icon: Icons.history })]
      : []),
    action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ];
  return list({
    placeholder: "Filter notifications by app or text…",
    empty: { title: "No notifications", description: "Nothing in the history yet", icon: Icons.bell },
    actions,
    status: [
      b.version ? `${b.title} ${b.version}` : b.title,
      on ? "Do Not Disturb on" : on === false ? "Do Not Disturb off" : "",
      count !== undefined ? `${count} in history` : "",
    ].filter(Boolean).join(" · "),
    items,
  });
};
