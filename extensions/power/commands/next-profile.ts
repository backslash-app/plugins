import { run } from "@backslash/api";
import { nextProfile, profileName } from "../lib.ts";
import { profiles, setProfile } from "../system.ts";

export default run(async () => {
  const all = await profiles();
  const next = nextProfile(all.list);
  if (!all.tool || !next) throw new Error("No power profiles: install power-profiles-daemon (or tuned-ppd)");
  await setProfile(all.tool, next.id);
  return `${profileName(next.id)} profile`;
});
