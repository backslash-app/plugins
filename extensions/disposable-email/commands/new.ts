import { clipboard, run } from "@backslash/api";
import { createAccount } from "../api.ts";

// Creates a random address, makes it the current one and copies it.
export default run(async () => {
  const a = await createAccount();
  await clipboard.write(a.address);
  return `Copied ${a.address}`;
});
