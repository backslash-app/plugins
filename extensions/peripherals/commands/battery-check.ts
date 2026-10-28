import { run, updateCommandMetadata } from "@backslash/api";
import { lowestSummary } from "../lib.ts";
import { load } from "../system.ts";

export default run(async ({ launchType }) => {
  const { devices } = await load();
  const lowest = lowestSummary(devices);
  await updateCommandMetadata({ subtitle: lowest ?? null });
  if (launchType !== "background") return lowest ? `Lowest: ${lowest}` : "No device reports its battery";
});
