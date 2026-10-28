import { openExternal, run } from "@backslash/api";
import { appendUri, captureLine, pickVault, stripMd } from "../lib.ts";
import { loadVaults, todayNote } from "../vault.ts";

// Appends one line through Obsidian itself (obsidian://new with append and
// silent): no write access to your vault is needed, and sync sees the change.
export default run<{ text: string }>(async ({ args, preferences }) => {
  const text = String(args.text ?? "").trim();
  if (!text) throw new Error("Type what to capture after the command");
  const vault = pickVault(await loadVaults(), preferences.vault);
  if (!vault) throw new Error("No Obsidian vault found: open one in Obsidian first");
  const inbox = String(preferences.captureTo ?? "daily").toLowerCase().startsWith("inbox");
  const path = inbox ? `${String(preferences.inbox || "Inbox").replace(/^\/+/, "")}` : (await todayNote(vault)).path;
  const line = captureLine(text, new Date(), preferences.timestamp !== false);
  await openExternal(appendUri(vault.name, path, `\n${line}`));
  return `Added to ${stripMd(path)}`;
});
