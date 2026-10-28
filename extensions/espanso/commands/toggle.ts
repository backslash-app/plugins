import { run } from "@backslash/api";
import { espanso, running } from "../api.ts";

export default run(async () => {
  if (!(await running())) {
    await espanso(["start"]);
    return "Espanso started";
  }
  await espanso(["cmd", "toggle"]);
  return "Espanso toggled: it shows whether it is on in its tray icon";
});
