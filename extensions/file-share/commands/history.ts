import { type Action, action, copy, Icons, type Item, list, meta, open, refresh, toast } from "@backslash/api";
import { delete0x0, deletePrivatebin, forget, history, update } from "../api.ts";
import { expiresIn, isExpired, receiveCommand, SERVICE_NAMES, type Share, shareText, size } from "../lib.ts";
import { forgetLog, stop, type TransferState, transferState } from "../system.ts";

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
    .replace(",", "");

const CROC_LOOK: Record<TransferState["state"], { text: string; color: "blue" | "yellow" | "green" | "red" | "gray" }> =
  {
    waiting: { text: "waiting for receiver", color: "yellow" },
    sending: { text: "sending", color: "blue" },
    done: { text: "received", color: "green" },
    failed: { text: "failed", color: "red" },
    stopped: { text: "stopped", color: "gray" },
  };

async function removeEverywhere(s: Share): Promise<string> {
  if (s.service === "0x0") await delete0x0(s);
  else if (s.service === "privatebin") await deletePrivatebin(s);
  else if (s.unit) await stop(s.unit);
  await forget(s);
  await forgetLog(s.log);
  return s.service === "croc" ? "Transfer stopped" : `Deleted from ${SERVICE_NAMES[s.service]}`;
}

function shareItem(s: Share, croc?: TransferState): Item {
  const expired = isExpired(s);
  const look = croc ? CROC_LOOK[croc.state] : undefined;
  const live = s.service === "croc" ? !!croc?.running : !expired;
  const canDelete = s.service === "0x0" ? !!s.token : s.service === "privatebin" ? !!s.deleteUrl : !!croc?.running;
  const icon = s.service === "0x0" ? Icons.globe : s.service === "privatebin" ? Icons.lock : Icons.bolt;
  const tint = !live ? "gray" : s.service === "0x0" ? "orange" : s.service === "privatebin" ? "green" : "blue";
  const actions: Action[] = s.service === "croc"
    ? [
      copy(shareText(s), "Copy Code Phrase", { concealed: true }),
      copy(receiveCommand(s.code ?? ""), "Copy Receive Command", {
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        concealed: true,
      }),
      ...(s.webUrl ? [copy(s.webUrl, "Copy Web Receive Link", { icon: Icons.link, concealed: true })] : []),
    ]
    : [
      copy(shareText(s), "Copy Link", { concealed: s.service === "privatebin" }),
      open(s.url ?? "", "Open Link", { shortcut: "<Ctrl>o" }),
    ];
  actions.push(
    action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ...(canDelete
      ? [action(s.service === "croc" ? "Stop Transfer" : `Delete from ${SERVICE_NAMES[s.service]}`, async () => {
        await toast(await removeEverywhere(s), { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: s.service === "croc"
          ? "Stop waiting for the receiver?"
          : `Delete ${s.name} from ${SERVICE_NAMES[s.service]}?`,
        shortcut: "<Ctrl>x",
        section: "Remove",
      })]
      : []),
    action("Forget", async () => {
      await forget(s);
      await forgetLog(s.log);
      return refresh();
    }, {
      icon: Icons.minus,
      shortcut: "<Ctrl><Shift>x",
      section: "Remove",
      ...(live && s.service !== "croc" ? { confirm: "Forget it here? It stays online until it expires" } : {}),
    }),
  );
  const status = s.service === "croc"
    ? { tag: look!.text, color: look!.color }
    : expired
    ? { tag: "expired", color: "gray" as const }
    : { text: `expires ${expiresIn(s.expires)}`, color: undefined };
  return {
    id: s.id,
    title: s.name,
    subtitle: s.service === "croc" ? `code ${s.code}` : s.url,
    icon: { source: icon, tint },
    section: live ? "Active" : "Expired or Done",
    keywords: [SERVICE_NAMES[s.service], s.kind, ...(s.paths ?? [])],
    accessories: [
      ...(s.burn ? [{ icon: Icons.eyeOff, tooltip: "Burns after reading" }] : []),
      ...(s.password ? [{ icon: Icons.key, tooltip: "Password protected" }] : []),
      {
        tag: s.service === "0x0" ? "0x0.st · public" : SERVICE_NAMES[s.service],
        color: s.service === "0x0" ? "orange" : "gray",
      },
      status,
    ],
    detail: {
      markdown: s.service === "croc"
        ? `## ${s.name}\n\nThe receiver runs:\n\n\`\`\`\n${
          receiveCommand(s.code ?? "")
        }\n\`\`\`\n\n(\`croc ${s.code}\` on Windows)${croc?.text ? `\n\n> ${croc.text}` : ""}`
        : s.service === "0x0"
        ? `## ${s.name}\n\n**Public link**: anyone who has it can download the file until it expires.${
          s.token ? "" : "\n\n0x0.st gave no delete token (it already had this file): it stays until it expires."
        }`
        : `## ${s.name}\n\nEncrypted: the key is the part after \`#\` in the link.${
          s.burn ? " It is deleted after the first reading." : ""
        }`,
      metadata: [
        meta.text("Service", SERVICE_NAMES[s.service], { icon }),
        meta.text("Shared", when(s.created), { icon: Icons.clock }),
        ...(s.expires
          ? [meta.text("Expires", `${when(s.expires)} (${expiresIn(s.expires)})`, { icon: Icons.hourglass })]
          : []),
        ...(s.bytes !== undefined ? [meta.text("Size", size(s.bytes))] : []),
        ...(s.paths?.length ? [meta.text("Files", s.paths.map((p) => p.split("/").pop()).join(", "))] : []),
        ...(s.url ? [meta.link("Link", new URL(s.url).hostname, s.url)] : []),
      ],
    },
    actions,
  };
}

export default list({
  placeholder: "Filter shared files…",
  empty: {
    title: "Nothing shared yet",
    description: "Copy files or text and open Share Files: links and croc codes land here",
    icon: Icons.history,
  },
  status: (items) => `${items.filter((i) => i.section === "Active").length} active · ${items.length} shared`,
  actions: [
    action("Forget Expired", async () => {
      const all = await history();
      const gone = all.filter((s) => s.service !== "croc" && isExpired(s));
      for (const s of gone) await forget(s);
      await toast(`${gone.length} forgotten`);
      return refresh();
    }, { icon: Icons.archive, section: "Remove" }),
  ],
  async items() {
    const all = await history();
    const states = await Promise.all(
      all.map((
        s,
      ) => (s.service === "croc" && s.unit && s.log ? transferState(s.unit, s.log) : Promise.resolve(undefined))),
    );
    // Remember finished transfers, their units are gone for good.
    await Promise.all(all.map((s, i) => {
      const st = states[i];
      return st && !st.running && !s.expires ? update({ ...s, expires: Date.now() }) : undefined;
    }));
    return all.map((s, i) => shareItem(s, states[i]))
      .sort((a, b) => (a.section === b.section ? 0 : a.section === "Active" ? -1 : 1));
  },
});
