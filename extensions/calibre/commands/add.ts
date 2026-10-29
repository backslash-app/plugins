import { clipboard, run } from "@backslash/api";
import { BOOK_EXTENSIONS, copiedFiles } from "../lib.ts";
import { addBooks, locate } from "../library.ts";

export default run(async ({ preferences: p }) => {
  const files = copiedFiles(await clipboard.read());
  const books = files.filter((f) => BOOK_EXTENSIONS.test(f));
  if (!files.length) throw new Error("Copy book files in your file manager first, then run this again");
  if (!books.length) throw new Error("The copied files aren't e-books (EPUB, PDF, MOBI, AZW3, CBZ…)");
  const lib = await locate(p.library);
  const ids = await addBooks(lib, {
    url: String(p.serverUrl ?? "").trim() || undefined,
    user: String(p.serverUser ?? "").trim() || undefined,
    password: String(p.serverPassword ?? "") || undefined,
  }, books);
  const n = ids.length || books.length;
  const skipped = files.length - books.length;
  return `${n} book${n === 1 ? "" : "s"} added to Calibre${
    skipped ? ` (${skipped} other file${skipped === 1 ? "" : "s"} skipped)` : ""
  }`;
});
