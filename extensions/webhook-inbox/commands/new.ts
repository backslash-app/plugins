import { clipboard, run } from "@backslash/api";
import { newInbox, type Prefs } from "../api.ts";
import { webhookUrl } from "../lib.ts";

// Creates a webhook URL, makes it the current inbox and copies it.
export default run(async ({ preferences }) => {
  const inbox = await newInbox(preferences as Prefs);
  await clipboard.write(webhookUrl(inbox.uuid));
  return `Copied ${webhookUrl(inbox.uuid).replace("https://", "")}`;
});
