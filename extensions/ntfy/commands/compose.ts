import { config } from "../api.ts";
import { composeForm } from "../views.ts";

export default ({ preferences }: { preferences: Record<string, unknown> }) => composeForm(config(preferences));
