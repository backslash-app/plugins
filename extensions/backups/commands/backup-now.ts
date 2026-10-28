import { run } from "@backslash/api";
import { repoLabel } from "../lib.ts";
import { backUp, dejaDup, launchDejaDup, type Prefs, repos } from "../backups.ts";

/** Backs up every configured repository in the background, or asks Déjà Dup to. */
export default run(async ({ preferences }) => {
  const p = preferences as Prefs;
  const list = repos(p);
  if (!list.length) {
    const dd = await dejaDup();
    if (!dd) throw new Error("No backup configured: set a restic or Borg repository in Settings, or install Déjà Dup");
    launchDejaDup(dd.flatpak, ["--backup"]);
    return "Déjà Dup is backing up";
  }
  const names: string[] = [];
  for (const r of list) {
    const name = `${r.kind === "restic" ? "restic" : "Borg"} ${repoLabel(r.location)}`;
    await backUp(r, p, "background", name);
    names.push(name);
  }
  return `Backing up to ${names.join(" and ")}: a notification tells when it's done`;
});
