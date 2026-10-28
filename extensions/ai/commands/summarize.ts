import { languageRule, textTool } from "../tools.ts";

export default textTool(
  "Summarize",
  (prefs) => `Summarize the user's text in a few short bullet points, most important first. ${languageRule(prefs)}`,
);
