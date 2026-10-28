import { run } from "@backslash/api";
import { client, type Prefs } from "../api.ts";
import { toggleAltSpeed } from "../ui.ts";

export default run(async ({ preferences }) => await toggleAltSpeed(await client(preferences as Prefs)));
