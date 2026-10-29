import { run, updateCommandMetadata } from "@backslash/api";
import { clock } from "../lib.ts";
import { recording, startRecording, stopRecording } from "../system.ts";

export default run(async (ctx) => {
  if (await recording()) {
    const { rec, transcribing } = await stopRecording(ctx);
    await updateCommandMetadata({ subtitle: null }).catch(() => {});
    const length = rec ? ` (${clock((Date.now() - rec.started) / 1000)})` : "";
    return transcribing ? `Saved${length}: transcribing…` : `Voice note saved${length}`;
  }
  await startRecording(ctx);
  await updateCommandMetadata({ subtitle: "Recording… run again to stop" }).catch(() => {});
  return "Recording… run Record Voice Note again to stop";
});
