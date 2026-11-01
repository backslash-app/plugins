import { Icons, list } from "@backslash/api";
import { FILTERS, relationOf } from "../lib.ts";
import { results, status } from "../views.ts";

export default list({
  placeholder: 'A word, or: syn happy · rhyme orange · like "fast car" · adj ocean · h*py',
  empty: { title: "Type a word", description: "Synonyms, antonyms, rhymes and more, in English", icon: Icons.book },
  filter: { options: FILTERS, default: "all" },
  status,
  search: (query, ctx) => results(query, relationOf(ctx.filter), ctx.signal),
});
