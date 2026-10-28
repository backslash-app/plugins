import { run, updateCommandMetadata } from "@backslash/api";
import { detect } from "../backends.ts";

export default run(async () => {
  const b = await detect();
  if (!b) throw new Error("No notification daemon found (mako, Dunst, SwayNotificationCenter, GNOME, Xfce, Cinnamon)");
  if (!b.setDnd) throw new Error(`${b.title} doesn't let other apps switch Do Not Disturb`);
  const on = await b.dnd();
  await b.setDnd(!on);
  await updateCommandMetadata({ subtitle: on ? null : "Do Not Disturb" }).catch(() => {});
  return on ? "Do Not Disturb off" : "Do Not Disturb on";
});
