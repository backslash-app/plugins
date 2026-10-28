import { run } from "@backslash/api";
import { espanso, running } from "../api.ts";

export default run(async () => {
  const was = await running();
  await espanso([was ? "restart" : "start"]);
  return was ? "Espanso restarted" : "Espanso started";
});
