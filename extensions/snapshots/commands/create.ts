import { run, updateCommandMetadata } from "@backslash/api";
import { createSnapshot, defaultTool } from "../snapshots.ts";

export default run<{ description?: string }>(async ({ args }) => {
  const target = await defaultTool();
  if (!target) throw new Error("Neither Snapper nor Timeshift is installed: install one with your package manager");
  const description = (args.description ?? "").trim() || "Created from Backslash";
  const id = await createSnapshot(target.tool, {
    description,
    config: target.config,
    cleanup: "number",
    important: false,
  });
  await updateCommandMetadata({ subtitle: null }).catch(() => {});
  const where = target.tool === "snapper" ? `Snapper ${target.config}` : "Timeshift";
  return `${where} snapshot ${id ?? ""} created`.replace(/\s+/g, " ");
});
