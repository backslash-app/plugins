import { run, storage, toast, updateCommandMetadata } from "@backslash/api";
import {
  formatTemp,
  LEVEL_TITLES,
  levelOf,
  limits,
  newWarnings,
  readingTitle,
  summaryLine,
  type Warned,
} from "../lib.ts";
import { notify, read } from "../system.ts";

const WARNED = "warned";

// Every few minutes: the temperatures under this command in the search, and a notification when one gets hot.
export default run(async ({ preferences, launchType }) => {
  const background = launchType === "background";
  const f = preferences.fahrenheit === true;
  const override = Number(preferences.threshold) > 0 ? Number(preferences.threshold) : undefined;
  // nvidia-smi would wake a sleeping GPU every few minutes: only when asked from the launcher.
  const { readings } = await read({ nvidia: !background && preferences.nvidia !== false });
  if (!readings.length) {
    await updateCommandMetadata({ subtitle: null });
    if (background) return;
    throw new Error("No temperature sensor found: install lm-sensors and run sudo sensors-detect");
  }
  const line = summaryLine(readings, f);
  const previous = (await storage.get<Warned>(WARNED).catch(() => undefined)) ?? {};
  const { warn, next } = newWarnings(readings, previous, override);
  await storage.set(WARNED, next).catch(() => {});

  const hot = readings.filter((r) => r.unit === "°C" && ["high", "critical"].includes(levelOf(r, override)));
  await updateCommandMetadata({ subtitle: hot.length ? `${line} · ${hot.length} hot` : line });

  for (const { reading, level } of warn) {
    const l = limits(reading, override);
    const title = `${readingTitle(reading)} is ${LEVEL_TITLES[level].toLowerCase()}: ${formatTemp(reading.value, f)}`;
    const body = level === "critical"
      ? `At its critical mark (${formatTemp(l.crit, f)}): the computer may slow down or shut off to protect itself.`
      : `Above ${formatTemp(l.high, f)}. Check what is running, and that the fans and vents are clear.`;
    if (preferences.notify !== false) await notify(title, body, level === "critical");
    if (!background) await toast(title, { style: "failure", message: body });
  }
  if (background) return;
  return hot.length ? `${hot.length} sensor${hot.length === 1 ? "" : "s"} hot · ${line}` : line;
});
