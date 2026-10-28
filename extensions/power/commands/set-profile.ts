import { run } from "@backslash/api";
import { profileName } from "../lib.ts";
import { profiles, setProfile } from "../system.ts";

export default run<{ profile: string }>(async ({ args }) => {
  const all = await profiles();
  if (!all.tool) throw new Error("No power profiles: install power-profiles-daemon (or tuned-ppd)");
  const wanted = args.profile.toLowerCase().replace(/\s+/g, "-");
  const p = all.list.find((x) => x.id === wanted) ??
    all.list.find((x) => x.id.includes(wanted.replace(/^(saver|eco|save)$/, "power-saver")));
  if (!p) throw new Error(`No “${args.profile}” profile: ${all.list.map((x) => x.id).join(", ")}`);
  await setProfile(all.tool, p.id);
  return `${profileName(p.id)} profile`;
});
