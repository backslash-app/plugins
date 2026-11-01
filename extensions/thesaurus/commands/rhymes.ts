import { Icons, list } from "@backslash/api";
import { results, status } from "../views.ts";

// Perfect rhymes by default; the chip switches to near rhymes or sound-alikes.
export default list({
  placeholder: "A word to rhyme with…",
  empty: { title: "Type a word", description: "Rhymes grouped by syllable count", icon: Icons.music },
  filter: {
    options: [
      { value: "rhy", title: "Rhymes" },
      { value: "nry", title: "Near Rhymes" },
      { value: "sl", title: "Sounds Like" },
    ],
    default: "rhy",
  },
  status,
  search: (query, ctx) => {
    const filter = ctx.filter === "nry" || ctx.filter === "sl" ? ctx.filter : "rhy";
    // A typed prefix ("syn happy") still wins over the chip.
    return results(query, filter, ctx.signal);
  },
});
