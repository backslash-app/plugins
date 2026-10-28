import { run } from "@backslash/api";
import { toggleRecording } from "../capture.ts";

export default run(toggleRecording(false));
