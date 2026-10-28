import { run } from "@backslash/api";
import { describeLanguages, grabberInstall, installTesseract } from "../lib.ts";
import { family, Missing, preferredLanguages, recognize, session } from "../system.ts";

// Hides the launcher right away; the result arrives as a notification and
// in the clipboard.
export default run(async ({ preferences }) => {
  try {
    const languages = preferredLanguages(preferences);
    // The message flashes for half a second before the launcher hides.
    await recognize(languages, { wait: 0.9 });
    return `Select the text to read (${describeLanguages(languages)})`;
  } catch (e) {
    if (!(e instanceof Missing)) throw e;
    const fam = (await family()) ?? "debian";
    const how = e.message.startsWith("Tesseract has no")
      ? "open Text from Screen to see the installed languages"
      : e.message.startsWith("Tesseract")
      ? installTesseract(fam)
      : grabberInstall(session(), fam);
    throw new Error(`${e.message}: ${how}`);
  }
});
