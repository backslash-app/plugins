import { run, updateCommandMetadata } from "@backslash/api";
import { stop } from "../player.ts";
import { serversFrom } from "../views.ts";

export default run(async ({ preferences }) => {
  const was = await stop(serversFrom(preferences).abs);
  await updateCommandMetadata({ subtitle: null }).catch(() => {});
  if (!was) return "Nothing was playing";
  return was.source === "abs" ? `Stopped ${was.title}, progress saved` : `Stopped ${was.title}`;
});
