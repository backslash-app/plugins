import { run } from "@backslash/api";
import { describeMedia, urlMedia } from "../lib.ts";
import { cast, copiedMedia, pickDevice } from "../system.ts";

// Casts the copied link or file to the device used last.
export default run(async (ctx) => {
  const typed = ctx.query.trim().match(/^https?:\/\/\S+/)?.[0];
  const m = typed ? urlMedia(typed) : await copiedMedia();
  if (!m) throw new Error("Copy a link, or a video, song or picture in your file manager, first");
  const d = await pickDevice();
  await cast(d, m);
  return `Playing ${describeMedia(m).title} on ${d.name}`;
});
