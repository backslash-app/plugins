import { languageRule, textTool } from "../tools.ts";

export default textTool(
  "Explain",
  (prefs) =>
    `Explain the user's text simply: what it means or does, and any jargon or code in it. Be brief. ${
      languageRule(prefs)
    }`,
);
