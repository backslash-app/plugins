import { run, updateCommandMetadata } from "@backslash/api";
import { tempo } from "../api.ts";
import { tempoSubtitle } from "../lib.ts";

/** Keeps "Today Blue · Tomorrow Red" under the command in the root search, every hour. */
export default run(async ({ launchType, signal }) => {
  const t = await tempo({ signal, season: false });
  const subtitle = tempoSubtitle(t.today, t.tomorrow);
  await updateCommandMetadata({ subtitle });
  if (launchType !== "background") return subtitle ?? "Tempo color not known yet";
});
