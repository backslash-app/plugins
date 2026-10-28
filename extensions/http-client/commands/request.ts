import { action, close, copy, Icons, type Item, list } from "@backslash/api";
import { formatBytes, hasSecret, parseInput, type Request, shortUrl, toCurl, validate } from "../lib.ts";
import { clearHistory, historyItem, loadHistory, loadSaved, requestForm, savedItem, sendAndShow } from "../views.ts";

const matches = (q: string, ...fields: string[]) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = fields.join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};

function requestItem(r: Request): Item {
  let problem: string | undefined;
  try {
    validate(r);
  } catch (e) {
    problem = (e as Error).message;
  }
  if (problem) {
    return {
      id: "invalid",
      title: problem,
      subtitle: `${r.method} ${r.url}`,
      icon: { source: Icons.alert, tint: "red" },
      section: "Request",
    };
  }
  return {
    id: "request",
    title: `${r.method} ${shortUrl(r.url)}`,
    subtitle: r.body ? `with a ${formatBytes(new TextEncoder().encode(r.body).length)} body` : "Enter to send",
    icon: { source: Icons.arrowRight, tint: "blue" },
    section: "Request",
    accessories: r.headers.length ? [{ text: `${r.headers.length} header${r.headers.length > 1 ? "s" : ""}` }] : [],
    detail: {
      markdown: `\`\`\`sh\n${toCurl(r)}\n\`\`\`${r.body ? `\n\n**Body**\n\n\`\`\`\n${r.body}\n\`\`\`` : ""}`,
    },
    actions: [
      action("Send Request", (ctx) => sendAndShow(r, ctx), { icon: Icons.arrowRight }),
      action("Save Request…", () => requestForm({ request: r }), { icon: Icons.bookmark, shortcut: "<Ctrl>s" }),
      copy(toCurl(r), "Copy as curl", {
        concealed: hasSecret(r),
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      action("Edit Headers and Body…", () => requestForm({ request: r }), { icon: Icons.text, shortcut: "<Ctrl>e" }),
    ],
  };
}

export default list({
  placeholder: "GET https://api.example.com/users, a URL, or paste a curl command…",
  empty: {
    title: "Type a request",
    description: "A URL, METHOD URL [body], or a curl command. Saved requests and history show up here too.",
    icon: Icons.globe,
  },
  actions: [action("New Saved Request…", () => requestForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" })],
  status: (items) => {
    const saved = items.filter((i) => i.section === "Saved").length;
    const history = items.filter((i) => i.section === "History").length;
    return [saved && `${saved} saved`, history && `${history} in history`].filter(Boolean).join(" · ") ||
      "Responses open in a page with status, headers and body";
  },
  async search(query) {
    const items: Item[] = [];
    let parsed: Request | undefined;
    try {
      parsed = parseInput(query);
    } catch (e) {
      items.push({
        id: "invalid",
        title: (e as Error).message,
        subtitle: "Can't read this request",
        icon: { source: Icons.alert, tint: "red" },
        section: "Request",
      });
    }
    if (parsed) items.push(requestItem(parsed));
    const filter = parsed ? "" : query;
    const [saved, history] = await Promise.all([loadSaved(), loadHistory()]);
    items.push(
      ...saved.filter((s) => matches(filter, s.name, s.method, s.url)).map((s) => savedItem(s, "close")),
      ...history.filter((h) => matches(filter, h.method, h.url, String(h.status))).map((h) => {
        const item = historyItem(h, "close");
        item.actions = [
          ...item.actions!,
          action("Clear History", async () => {
            await clearHistory();
            return close();
          }, {
            icon: Icons.trash,
            destructive: true,
            confirm: "Forget every request in the history?",
            section: "Danger",
          }),
        ];
        return item;
      }),
    );
    return items;
  },
});
