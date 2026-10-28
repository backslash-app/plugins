import { run } from "@backslash/api";
import { toggleNight } from "../quick.ts";

export default run(({ preferences }) => toggleNight(Number(preferences.temperature) || 4000));
