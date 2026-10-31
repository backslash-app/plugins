import { clipboard, run, storage } from "@backslash/api";
import { buildDraft, renderDraft, summary } from "../lib.ts";
import { config, gather, windowFor } from "../sources.ts";

// Builds today's stand-up and copies it, in the format set in the preferences.
export default run(async (ctx) => {
  const cfg = config(ctx);
  const w = windowFor(cfg, "last");
  const found = await gather(cfg, w, ctx.signal);
  if (found.errors.length && !found.commits.length && !found.prs.length && !found.issues.length) {
    throw new Error(found.errors[0]);
  }
  const format = ctx.preferences.format === "slack" ? "slack" : "markdown";
  // What was left out in the Stand-up command stays out.
  const out = new Set((await storage.get<string[]>("excluded")) ?? []);
  const kept = {
    commits: found.commits.filter((c) => !out.has(`commit:${c.hash}`)),
    prs: found.prs.filter((p) => !out.has(`pr:${p.url}`)),
    issues: found.issues.filter((i) => !out.has(`issue:${i.identifier}`)),
  };
  const draft = buildDraft(w, kept, { tidy: cfg.tidy });
  await clipboard.write(renderDraft(draft, format, { blockers: cfg.blockers }));
  const warn = found.errors.length ? ` (${found.errors.join("; ")})` : "";
  return `Stand-up copied: ${summary(kept)}${warn}`;
});
