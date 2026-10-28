import {
  type Action,
  action,
  type Color,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { type Config, config, deleteGotify, gotifyMessages, poll, SetupError, setupItem } from "../api.ts";
import { ago, type Notification, notificationMarkdown, priorityInfo, splitTags, validTopic } from "../lib.ts";
import { allTopics, composeForm, saveTopics, topics } from "../views.ts";

function subscribeForm(c: Config) {
  return form({
    title: "Subscribe to a Topic",
    submitTitle: "Subscribe",
    fields: [field.text("topic", "Topic", { required: true, placeholder: "alerts-k3j9x" })],
    async submit(values) {
      const topic = String(values.topic ?? "").trim().replace(/^.*\//, "");
      const problem = validTopic(topic);
      if (problem) throw new Error(problem);
      await saveTopics([...await topics(), topic]);
      await toast(`Subscribed to ${topic}`, { style: "success", message: new URL(c.ntfy).host });
      return pop();
    },
  });
}

function listActions(c: Config): Action[] {
  return [
    action("Subscribe to Topic", () => subscribeForm(c), { icon: Icons.plus, shortcut: "<Ctrl>n", section: "Topics" }),
    action("Send Notification", () => composeForm(c), { icon: Icons.upload, shortcut: "<Ctrl>s", section: "Topics" }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Topics" }),
  ];
}

function item(c: Config, n: Notification, subscribed: string[]): Item {
  const p = priorityInfo(n.priority);
  const { emojis, words } = splitTags(n.tags);
  const firstLine = n.message.split("\n")[0];
  const topicUrl = n.service === "ntfy" ? `${c.ntfy}/${n.source}` : c.gotify;
  const actions: Action[] = [
    ...(n.click ? [open(n.click, "Open Link")] : []),
    ...n.actions.filter((a) => a.action === "view" && a.url).map((a) =>
      open(a.url!, a.label, { section: "Message Actions" })
    ),
    ...(n.attachment ? [open(n.attachment.url, `Open ${n.attachment.name}`, { icon: Icons.download })] : []),
    copy(n.message, "Copy Message", { shortcut: "<Ctrl><Shift>c" }),
    ...(n.title ? [copy(n.title, "Copy Title", { section: "Copy" })] : []),
    open(topicUrl, n.service === "ntfy" ? "Open Topic in Browser" : "Open Gotify", {
      icon: Icons.globe,
      shortcut: "<Ctrl>o",
    }),
    ...(n.service === "ntfy"
      ? [action(`Send to ${n.source}`, () => composeForm(c, { target: `ntfy:${n.source}` }), {
        icon: Icons.upload,
        shortcut: "<Ctrl>s",
        section: "Topics",
      })]
      : []),
    ...(n.service === "ntfy" && subscribed.includes(n.source)
      ? [action(`Unsubscribe from ${n.source}`, async () => {
        await saveTopics((await topics()).filter((t) => t !== n.source));
        return refresh();
      }, { icon: Icons.bellOff, destructive: true, confirm: `Stop showing ${n.source}?`, section: "Topics" })]
      : []),
    ...(n.gotifyId !== undefined
      ? [action("Delete Message", async () => {
        await deleteGotify(c, n.gotifyId!);
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: "Delete this Gotify message?",
        shortcut: "<Ctrl>Delete",
        section: "Gotify",
      })]
      : []),
    ...listActions(c),
  ];
  return {
    id: n.id,
    title: [emojis.join(""), n.title ?? firstLine].filter(Boolean).join(" "),
    subtitle: n.title ? firstLine : undefined,
    icon: { source: p.icon, tint: p.color },
    section: n.service === "ntfy" ? n.source : `Gotify · ${n.source}`,
    keywords: [n.source, ...n.tags, n.message.slice(0, 200)],
    accessories: [
      ...words.slice(0, 3).map((t) => ({ tag: t })),
      ...(n.priority >= 4 ? [{ tag: p.title.toLowerCase(), color: p.color as Color }] : []),
      ...(n.click || n.actions.length ? [{ icon: Icons.link, tooltip: n.click ?? "Has actions" }] : []),
      ...(n.attachment ? [{ icon: Icons.file, tooltip: n.attachment.name }] : []),
      { text: ago(n.time), tooltip: new Date(n.time).toLocaleString("en-GB") },
    ],
    detail: {
      markdown: notificationMarkdown(n),
      metadata: [
        meta.text(n.service === "ntfy" ? "Topic" : "Application", n.source, { icon: Icons.hash }),
        meta.text("Priority", `${p.title} (${n.priority})`, { icon: p.icon, color: p.color }),
        ...(n.tags.length ? [meta.tags("Tags", n.tags)] : []),
        meta.text("Received", new Date(n.time).toLocaleString("en-GB"), { icon: Icons.clock }),
        ...(n.click ? [meta.link("Link", n.click, n.click)] : []),
        meta.text("Service", n.service === "ntfy" ? new URL(c.ntfy).host : `Gotify (${new URL(c.gotify).host})`, {
          icon: Icons.server,
        }),
      ],
    },
    actions,
  };
}

let summary = "";

export default async ({ preferences }: { preferences: Record<string, unknown> }) => {
  let c: Config | undefined;
  let setup: SetupError | undefined;
  try {
    c = config(preferences);
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
    setup = e;
  }
  const names = c ? await allTopics(c) : [];
  const gotify = !!(c?.gotify && c.clientToken);
  return list({
    placeholder: "Filter notifications…",
    filter: {
      options: [
        { value: "all", title: "All" },
        ...names.map((t) => ({ value: `ntfy:${t}`, title: t })),
        ...(gotify ? [{ value: "gotify", title: "Gotify" }] : []),
      ],
      default: "all",
    },
    empty: {
      title: names.length || gotify ? "No recent notification" : "No topic yet",
      description: names.length || gotify
        ? `Nothing in the last ${c?.since ?? "24h"} (ntfy.sh keeps messages 12 hours)`
        : "Subscribe to a topic with Ctrl+N, or set a default topic in Settings",
      icon: Icons.bell,
    },
    status: () => summary,
    actions: c ? listActions(c) : [],
    async items({ filter, signal }) {
      if (setup || !c) return [setupItem(setup ?? new SetupError("Set up ntfy in Settings"))];
      if (!names.length && !gotify) return [];
      const subscribed = await topics();
      const chosen = filter?.startsWith("ntfy:") && names.includes(filter.slice(5)) ? [filter.slice(5)] : names;
      try {
        const [ntfy, got] = await Promise.all([
          filter === "gotify" ? Promise.resolve([]) : poll(c, chosen, signal),
          filter === "gotify" || filter === "all" || !filter ? gotifyMessages(c, signal) : Promise.resolve([]),
        ]);
        const all = [...ntfy, ...got].sort((a, b) => b.time - a.time);
        const urgent = all.filter((n) => n.priority >= 4).length;
        summary = [
          `${all.length} notification${all.length === 1 ? "" : "s"}`,
          `${chosen.length} topic${chosen.length === 1 ? "" : "s"}`,
          ...(urgent ? [`${urgent} high priority`] : []),
        ].join(" · ");
        // Topics in the order they were subscribed, each newest first.
        const order = (n: Notification) => n.service === "ntfy" ? names.indexOf(n.source) : names.length;
        return all.sort((a, b) => order(a) - order(b) || b.time - a.time).map((n) => item(c!, n, subscribed));
      } catch (e) {
        if (e instanceof SetupError) return [setupItem(e)];
        throw e;
      }
    },
  });
};
