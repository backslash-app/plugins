import { run } from "@backslash/api";
import { capture, captureServer, servers } from "../api.ts";
import { SERVICE_NAMES } from "../lib.ts";

// "Capture Memo Call Ada about the demo #work": saved at once, private unless set otherwise.
export default run<{ text: string }>(async ({ args, preferences }) => {
  const text = String(args.text ?? "").trim();
  if (!text) throw new Error("Type the memo after the command");
  const s = captureServer(servers(preferences), preferences.captureTo);
  const note = await capture(s, text, preferences);
  return `Saved to ${SERVICE_NAMES[s.service]}: ${note.title}`;
});
