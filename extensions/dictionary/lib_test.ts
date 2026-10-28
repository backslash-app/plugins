import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  cleanWikitext,
  decodeEntities,
  enrich,
  entryMarkdown,
  fromFreeDictionary,
  fromFrWikitext,
  fromRest,
  htmlToText,
  ipaLine,
  langOf,
  myMemoryUrl,
  parseQuery,
  parseTranslateQuery,
  parseTranslation,
  posColor,
  type RestResponse,
  wiktionaryUrl,
} from "./lib.ts";

// Trimmed from en.wiktionary.org/api/rest_v1/page/definition/house
const REST: RestResponse = {
  en: [
    {
      partOfSpeech: "Noun",
      language: "English",
      definitions: [
        {
          definition:
            'A <a rel="mw:WikiLink" href="/wiki/structure" title="structure">structure</a> built or serving as an <a href="/wiki/abode">abode</a> of human beings.',
          parsedExamples: [{ example: "This is my <b>house</b> and my family&#39;s ancestral home." }],
          examples: ["This is my <b>house</b> and my family's ancestral home."],
        },
        { definition: "" },
        {
          definition:
            '<span class="usage-label-sense">(<a href="/wiki/astrology">astrology</a>)</span> One of the twelve divisions.',
        },
      ],
    },
    {
      partOfSpeech: "Verb",
      language: "English",
      definitions: [{
        definition: "To keep within a structure or container.",
        examples: ["The car is <i>housed</i> in the garage."],
      }],
    },
    {
      partOfSpeech: "Noun",
      language: "English",
      definitions: [{ definition: "(<i>slang</i>) House music." }],
    },
  ],
  fr: [{ partOfSpeech: "Noun", language: "French", definitions: [{ definition: "house music" }] }],
};

const FREE = [
  {
    word: "house",
    phonetic: "/haʊs/",
    phonetics: [{ text: "/haʊs/", audio: "" }, { text: "/haʊz/" }],
    meanings: [
      {
        partOfSpeech: "noun",
        definitions: [{ definition: "A structure serving as an abode.", synonyms: ["home"] }],
        synonyms: ["dwelling", "home"],
        antonyms: [],
      },
      { partOfSpeech: "verb", definitions: [{ definition: "To keep within a structure.", example: "to house a car" }] },
    ],
  },
];

// Shaped like fr.wiktionary.org's wikitext of "maison".
const MAISON = `{{voir|Maison}}
== {{langue|fr}} ==
=== {{S|étymologie}} ===
: Du {{étyl|la|fr|mot=mansio}}, « séjour, demeure ».

=== {{S|nom|fr}} ===
{{fr-rég|mɛ.zɔ̃}}
'''maison''' {{pron|mɛ.zɔ̃|fr}} {{f}}
# [[bâtiment|Bâtiment]] servant de [[logement]] à une [[famille]].<ref>Une note.</ref>
#* {{exemple|Il habite une '''maison''' de campagne.|lang=fr}}
#* ''Les '''maisons''' du village étaient basses.'' {{source|{{w|Victor Hugo}}, ''Les Misérables'', 1862}}
#*: (traduction ignorée)
# {{figuré|fr}} [[famille|Famille]], [[lignée]].
#* {{exemple|lang=fr}}
## {{par extension}} [[entreprise|Entreprise]] [[commercial]]e.
# {{lexique|astrologie|fr}} Chacune des douze divisions du ciel.

==== {{S|synonymes}} ====
* [[demeure]]
* [[domicile]], [[logis]]
* {{lien|foyer|fr}}

==== {{S|antonymes}} ====
* [[cabane#fr|cabane]]

==== {{S|traductions}} ====
{{trad-début}}
* {{T|en}} : {{trad+|en|house}}
{{trad-fin}}

=== {{S|adjectif|fr}} ===
'''maison''' {{pron|mɛ.zɔ̃|fr}} {{invar}}
# {{familier|fr}} Fait sur place, de façon [[artisanal]]e.
#* {{exemple|Une tarte '''maison'''.|lang=fr}}

=== {{S|prononciation}} ===
* {{pron|mɛ.zɔ̃|fr}}

== {{langue|en}} ==
=== {{S|nom|en}} ===
'''maison''' {{pron|meɪˈzɒn|en}}
# Maisonnette.
`;

Deno.test("queries and languages", () => {
  assertEquals(parseQuery("fr:maison", "en"), { lang: "fr", word: "maison" });
  assertEquals(parseQuery(" EN : House ", "fr"), { lang: "en", word: "House" });
  assertEquals(parseQuery("pomme de terre", "fr"), { lang: "fr", word: "pomme de terre" });
  assertEquals(parseQuery("de:haus", "en"), { lang: "en", word: "de:haus" });
  assertEquals([langOf("fr"), langOf("Français"), langOf(undefined)], ["fr", "fr", "en"]);
  assertEquals(wiktionaryUrl("pomme de terre", "fr"), "https://fr.wiktionary.org/wiki/pomme_de_terre#fr");
});

Deno.test("HTML and entities", () => {
  assertEquals(decodeEntities("&lt;a&gt; &amp; &#39;x&#x27; &eacute;&nbsp;&unknown;"), "<a> & 'x' é &unknown;");
  assertEquals(
    htmlToText('<span class="x">(<a href="/y">astrology</a>)</span>  One  of twelve .'),
    "(astrology) One of twelve.",
  );
});

Deno.test("English: Wiktionary REST, merged by part of speech", () => {
  const entry = fromRest("house", REST)!;
  assertEquals(entry.groups.map((g) => g.pos), ["Noun", "Verb"]);
  assertEquals(entry.groups[0].senses.length, 3);
  assertEquals(entry.groups[0].senses[0].definition, "A structure built or serving as an abode of human beings.");
  assertEquals(entry.groups[0].senses[0].examples, ["This is my house and my family's ancestral home."]);
  assertEquals(entry.groups[0].senses[1].definition, "(astrology) One of the twelve divisions.");
  assertEquals(entry.groups[1].senses[0].examples, ["The car is housed in the garage."]);
  assertEquals(entry.url, "https://en.wiktionary.org/wiki/house#English");
  assertEquals(fromRest("x", {}), undefined);
});

Deno.test("English: dictionaryapi.dev adds pronunciation and synonyms", () => {
  const extra = fromFreeDictionary("house", FREE)!;
  assertEquals(extra.ipa, ["/haʊs/", "/haʊz/"]);
  assertEquals(extra.groups[0].synonyms, ["dwelling", "home"]);
  const entry = enrich(fromRest("house", REST)!, extra);
  assertEquals(entry.ipa, ["/haʊs/", "/haʊz/"]);
  assertEquals(entry.groups[0].synonyms, ["dwelling", "home"]);
  assertEquals(entry.groups[1].synonyms, []);
  assertEquals(ipaLine(entry), "/haʊs/ · /haʊz/");
  assertEquals(fromFreeDictionary("x", []), undefined);
});

Deno.test("wikitext cleanup", () => {
  assertEquals(
    cleanWikitext("[[bâtiment|Bâtiment]] de [[logement#fr|logement]].<ref>x</ref>"),
    "Bâtiment de logement.",
  );
  assertEquals(cleanWikitext("{{figuré|fr}} [[famille|Famille]]"), "(Figuré) Famille");
  assertEquals(cleanWikitext("{{lexique|cuisine|fr}} Plat"), "(cuisine) Plat");
  assertEquals(cleanWikitext("Le XIX{{e}} siècle, {{w|Victor Hugo}}"), "Le XIXe siècle, Victor Hugo");
  assertEquals(cleanWikitext("{{exemple|Un '''mot''' {{lien|rare|fr}}.|sens=x|lang=fr}}"), "Un mot rare.");
  assertEquals(cleanWikitext("{{unknown|42}}Texte &nbsp;ici <!-- note -->"), "Texte ici");
});

Deno.test("French: Wiktionnaire wikitext", () => {
  const entry = fromFrWikitext("maison", MAISON)!;
  assertEquals(entry.ipa, ["mɛ.zɔ̃"]);
  assertEquals(ipaLine(entry), "\\mɛ.zɔ̃\\");
  assertEquals(entry.etymology, "Du latin mansio, « séjour, demeure ».");
  assertEquals(entry.groups.map((g) => g.pos), ["Nom commun", "Adjectif"]);
  const nom = entry.groups[0];
  assertEquals(nom.gender, "féminin");
  assertEquals(nom.senses.map((s) => s.definition), [
    "Bâtiment servant de logement à une famille.",
    "(Figuré) Famille, lignée.",
    "(Par extension) Entreprise commerciale.",
    "(astrologie) Chacune des douze divisions du ciel.",
  ]);
  assertEquals(nom.senses[0].examples, ["Il habite une maison de campagne.", "Les maisons du village étaient basses."]);
  assertEquals(nom.senses[1].examples, []);
  assertEquals(nom.synonyms, ["demeure", "domicile", "logis", "foyer"]);
  assertEquals(nom.antonyms, ["cabane"]);
  assertEquals(entry.groups[1].senses[0].definition, "(Familier) Fait sur place, de façon artisanale.");
  assertEquals(entry.groups[1].gender, undefined);
  assertEquals(entry.url, "https://fr.wiktionary.org/wiki/maison#fr");
  // Other languages of the page are ignored; pages without French give nothing.
  assertEquals(entry.groups.some((g) => g.senses.some((s) => s.definition === "Maisonnette.")), false);
  assertEquals(fromFrWikitext("house", "== {{langue|en}} ==\n=== {{S|nom|en}} ===\n# A house."), undefined);
});

Deno.test("French: inflected forms and locutions", () => {
  const text = `== {{langue|fr}} ==
=== {{S|nom|fr|flexion}} ===
'''maisons''' {{pron|mɛ.zɔ̃|fr}} {{f}}
# ''Pluriel de'' [[maison]].
=== {{S|verbe|fr|num=1}} ===
'''manger''' {{pron|mɑ̃.ʒe|fr}} {{t|fr}}
# [[mâcher|Mâcher]] et [[avaler]].`;
  const entry = fromFrWikitext("maisons", text)!;
  assertEquals(entry.groups.map((g) => g.pos), ["Forme de nom commun", "Verbe"]);
  assertEquals(entry.groups[0].senses[0].definition, "Pluriel de maison.");
  assertEquals(entry.ipa, ["mɛ.zɔ̃", "mɑ̃.ʒe"]);
});

Deno.test("presentation", () => {
  assertEquals([posColor("Noun"), posColor("Nom commun"), posColor("Verbe"), posColor("Adjective")], [
    "blue",
    "blue",
    "green",
    "purple",
  ]);
  assertEquals(posColor("Forme de nom commun"), "gray");
  const md = entryMarkdown(fromFrWikitext("maison", MAISON)!);
  assertStringIncludes(md, "## Nom commun · féminin");
  assertStringIncludes(md, "> Il habite une maison de campagne.");
  assertStringIncludes(md, "**Synonymes:** demeure, domicile, logis, foyer");
  assertStringIncludes(md, "[Wiktionnaire](https://fr.wiktionary.org/wiki/maison#fr)");
});

Deno.test("translation: MyMemory", () => {
  const t = parseTranslation({
    responseData: { translatedText: "maison", match: 1 },
    responseStatus: 200,
    matches: [
      { translation: "maison", quality: 74, "created-by": "MT!" },
      { translation: "Maison", quality: 70 },
      { translation: "domicile", quality: "80", "created-by": "Wikipedia" },
    ],
  });
  assertEquals(t.text, "maison");
  assertEquals(t.alternatives, [{ text: "domicile", quality: 80, source: "Wikipedia" }]);
  assertThrows(() => parseTranslation({ responseStatus: 403, responseDetails: "'XX' IS AN INVALID TARGET LANGUAGE" }));
  assertThrows(() =>
    parseTranslation({
      responseStatus: 200,
      responseData: { translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS" },
    })
  );
  assertEquals(parseTranslateQuery("house", "en", "fr"), { from: "en", to: "fr", text: "house" });
  assertEquals(parseTranslateQuery("fr>en bonjour tout le monde", "en", "fr"), {
    from: "fr",
    to: "en",
    text: "bonjour tout le monde",
  });
  assertEquals(parseTranslateQuery(">de Haus", "en", "fr"), { from: "en", to: "de", text: "Haus" });
  assertEquals(parseTranslateQuery(">en maison", "en", "fr"), { from: "fr", to: "en", text: "maison" });
  assertStringIncludes(myMemoryUrl("a b", "en", "fr"), "langpair=en%7Cfr");
});
