// Shared by the no-view commands: errors read as what to install.
import type { Context } from "@backslash/api";
import { installCommands, type Mode, recorderPackages, screenshotPackages } from "./lib.ts";
import { family, MissingTool, recording, screenshot, session, startRecording, stopRecording } from "./system.ts";

async function hint(e: unknown, packages: string[]): Promise<never> {
  if (!(e instanceof MissingTool)) throw e;
  const fam = await family();
  const how = installCommands(packages, fam);
  throw new Error(`${e.message}. Install it: ${how.length === 1 ? how[0].command : packages.join(", ")}`);
}

/** Hides the launcher right away (no message), then captures in the background. */
export const capture = (mode: Mode) => async ({ preferences }: Context) => {
  const prefs = preferences as { delay?: number; copy?: boolean };
  await screenshot(mode, { delay: prefs.delay, copy: prefs.copy }).catch((e) =>
    hint(
      e,
      mode === "screen" ? screenshotPackages(session()).filter((p) => p !== "slurp") : screenshotPackages(session()),
    )
  );
};

/** Starts a recording, or stops the one in progress. */
export const toggleRecording = (area: boolean) => async ({ preferences }: Context) => {
  if (await recording()) {
    const rec = await stopRecording();
    return `Recording saved${rec ? `: ${rec.file.split("/").pop()}` : ""}`;
  }
  await startRecording(area, !!(preferences as { audio?: boolean }).audio).catch((e) =>
    hint(e, recorderPackages(session()))
  );
  return area ? "Select the area to record…" : "Recording… run again to stop";
};
