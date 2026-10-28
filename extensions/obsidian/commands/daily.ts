import { openExternal, run } from "@backslash/api";
import { obsidianUri, pickVault, stripMd } from "../lib.ts";
import { loadVaults, todayNote } from "../vault.ts";

// Today's note exists: open it. Otherwise let Obsidian create it, so the
// Daily notes plugin applies its folder and template.
export default run(async ({ preferences }) => {
  const vault = pickVault(await loadVaults(), preferences.vault);
  if (!vault) throw new Error("No Obsidian vault found: open one in Obsidian first");
  const today = await todayNote(vault);
  await openExternal(
    today.exists
      ? obsidianUri("open", { vault: vault.name, file: stripMd(today.path) })
      : obsidianUri("daily", { vault: vault.name }),
  );
  return today.exists ? `Opening ${stripMd(today.path)}` : `Creating today's note in ${vault.name}`;
});
