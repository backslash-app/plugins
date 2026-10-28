import { suggestedName } from "../keyring.ts";
import { generateForm } from "../views.ts";

export default async ({ preferences }: { preferences: Record<string, unknown> }) =>
  generateForm(await suggestedName(), String(preferences.terminal ?? "").trim() || undefined);
