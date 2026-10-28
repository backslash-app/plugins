import { clipboard, run } from "@backslash/api";
import { COIN, language, randomInt } from "../lib.ts";

const env = (k: string) => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined;
  }
};

// Flashes the face and copies it.
export default run(async ({ preferences }) => {
  const lang = language((preferences as { language?: string }).language, env("LC_ALL") || env("LANG"));
  const face = COIN[lang][randomInt(0, 1)];
  await clipboard.write(face);
  return face;
});
