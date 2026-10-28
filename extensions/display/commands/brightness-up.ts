import { run } from "@backslash/api";
import { brightness } from "../quick.ts";

export default run(({ preferences }) => brightness({ step: 10 }, !!preferences.ddc));
