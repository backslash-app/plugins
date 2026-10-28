import { run, updateCommandMetadata } from "@backslash/api";
import { toggleDefaultMic } from "../system.ts";

export default run(async () => {
  const muted = await toggleDefaultMic();
  await updateCommandMetadata({ subtitle: muted ? "Muted" : "On" });
  return muted ? "Microphone muted" : "Microphone on";
});
