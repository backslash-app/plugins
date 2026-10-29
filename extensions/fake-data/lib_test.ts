import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { CARD_BRANDS, FR } from "./data.ts";
import {
  csvCell,
  customShape,
  Faker,
  FIELDS,
  FORMATS,
  frVat,
  generate,
  groupCard,
  groupIban,
  ibanCheck,
  ibanValid,
  identifier,
  KNOWN_TEST_CARDS,
  luhnDigit,
  luhnValid,
  mod97,
  nirKey,
  parseCount,
  render,
  ribKey,
  Rng,
  sample,
  shape,
  SHAPES,
  slug,
  sqlValue,
} from "./lib.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");

Deno.test("the generator is deterministic for a seed", () => {
  const a = new Rng("tests"), b = new Rng("tests"), c = new Rng("other");
  const seq = (r: Rng) => Array.from({ length: 5 }, () => r.uint32());
  const first = seq(a);
  assertEquals(first, seq(b));
  assertNotEquals(first, seq(c));
  const r = new Rng("range");
  for (let i = 0; i < 1000; i++) {
    const n = r.int(3, 7);
    assert(n >= 3 && n <= 7);
    const f = r.float();
    assert(f >= 0 && f < 1);
  }
  assertEquals(generate(shape("person")!, 5, "fr", "seed", NOW), generate(shape("person")!, 5, "fr", "seed", NOW));
});

Deno.test("Luhn", () => {
  assert(luhnValid("4242424242424242"));
  assert(luhnValid("378282246310005"));
  assert(!luhnValid("4242424242424241"));
  assertEquals(luhnDigit("7992739871"), 3);
  // Real SIREN and SIRET numbers pass Luhn.
  assert(luhnValid("732829320"));
  assert(luhnValid("73282932000074"));
  for (const c of KNOWN_TEST_CARDS) assert(luhnValid(c.number), c.number);
});

Deno.test("IBAN, RIB key, VAT and NIR checksums", () => {
  assert(ibanValid("FR76 3000 6000 0112 3456 7890 189"));
  assert(ibanValid("GB82WEST12345698765432"));
  assert(ibanValid("DE89370400440532013000"));
  assert(!ibanValid("FR7630006000011234567890188"));
  assertEquals(ibanCheck("FR", "30006000011234567890189"), "76");
  assertEquals(ibanCheck("GB", "WEST12345698765432"), "82");
  assertEquals(ribKey("30006", "00001", "12345678901"), "89");
  assertEquals(mod97("3214282912345698765432161182"), 1);
  assertEquals(frVat("303265045"), "FR40303265045");
  assertEquals(nirKey("2550814168025"), "38");
  assertEquals(groupIban("FR7630006000011234567890189"), "FR76 3000 6000 0112 3456 7890 189");
  assertEquals(groupCard("4242424242424242"), "4242 4242 4242 4242");
  assertEquals(groupCard("378282246310005"), "3782 822463 10005");
});

Deno.test("generated identifiers are valid", () => {
  for (const locale of ["fr", "en"] as const) {
    const g = new Faker(new Rng(`ids-${locale}`), locale, NOW);
    for (let i = 0; i < 300; i++) {
      const iban = g.iban();
      assert(ibanValid(iban), iban);
      assertMatch(iban, locale === "fr" ? /^FR\d{25}$/ : /^GB\d{2}[A-Z]{4}\d{14}$/);
      if (locale === "fr") {
        assertEquals(ribKey(iban.slice(4, 9), iban.slice(9, 14), iban.slice(14, 25)), iban.slice(25));
      }
      const siren = g.siren();
      assert(luhnValid(siren) && siren.length === 9, siren);
      const siret = g.siret(siren);
      assert(luhnValid(siret) && siret.length === 14 && siret.startsWith(siren), siret);
      const card = g.card();
      assert(luhnValid(card.number), card.number);
      const brand = CARD_BRANDS.find((b) => b.brand === card.brand)!;
      assertEquals(card.number.length, brand.length);
      assert(brand.prefixes.some((p) => card.number.startsWith(p)));
      assertMatch(card.expiry, /^(0[1-9]|1[0-2])\/\d{2}$/);
      assertMatch(g.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assertMatch(
        g.ipv4(),
        /^(192\.0\.2|198\.51\.100|203\.0\.113|10\.\d+\.\d+|192\.168\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+)\.\d+$/,
      );
      assertMatch(g.ipv6(), /^2001:db8(:[0-9a-f]{1,4}){6}$/);
      assertEquals(parseInt(g.mac().slice(0, 2), 16) & 0x03, 0x02);
    }
  }
});

Deno.test("French data looks French", () => {
  const g = new Faker(new Rng("fr"), "fr", NOW);
  for (let i = 0; i < 200; i++) {
    const p = g.place();
    assertMatch(p.postcode, /^\d{5}$/);
    if (p.city.name === "Paris") assertMatch(p.postcode, /^750(0[1-9]|1\d|20)$/);
    if (p.city.name === "Lyon") assertMatch(p.postcode, /^6900[1-9]$/);
    assertMatch(g.phone(), /^0[1-6] (99 00|61 91|53 01|65 71|36 49|39 98) \d{2} \d{2}$/);
    const person = g.person();
    assert(FR[person.gender].includes(person.first));
    const nir = g.nir(person, "1990-04-12");
    assertMatch(nir, /^[12]9004\d{10}$/);
    assertEquals(nirKey(nir.slice(0, 13)), nir.slice(13));
  }
  assertEquals(g.intlPhone("06 39 98 12 34"), "+33 6 39 98 12 34");
});

Deno.test("English data", () => {
  const g = new Faker(new Rng("en"), "en", NOW);
  for (let i = 0; i < 100; i++) assertMatch(g.phone(), /^\(\d{3}\) 555-01\d{2}$/);
  assertEquals(g.intlPhone("(212) 555-0123"), "+1 212-555-0123");
  const address = g.fullAddress(g.place());
  assertMatch(address, /^\d+ [A-Za-z ]+, [A-Za-z ]+, [A-Z]{2} \d{5}$/);
});

Deno.test("emails match the names", () => {
  for (const r of generate(shape("person")!, 50, "fr", "emails", NOW)) {
    const email = String(r.email);
    assertMatch(email, /^[a-z0-9._]+@example\.(fr|com|org|net)$/);
    assert(email.includes(slug(String(r.last_name))) || email.startsWith(slug(String(r.first_name))), email);
  }
  assertEquals(slug("Hélène Lefèvre"), "helenelefevre");
});

Deno.test("every shape and field generates", () => {
  for (const s of SHAPES) {
    const rows = generate(s, 3, "fr", "all", NOW);
    assertEquals(rows.length, 3);
    assertEquals(rows.map((r) => r.id), [1, 2, 3]);
    for (const r of rows) for (const v of Object.values(r)) assert(v !== undefined, s.id);
  }
  for (const f of FIELDS) assert(sample(f.id, "en", "x", NOW) !== undefined, f.id);
  const order = generate(shape("order")!, 1, "en", "o", NOW)[0];
  assertEquals(order.total, Math.round(Number(order.unit_price) * Number(order.quantity) * 100) / 100);
  const company = generate(shape("company")!, 1, "fr", "c", NOW)[0];
  assert(String(company.siret).startsWith(String(company.siren)));
  assertEquals(company.vat_number, frVat(String(company.siren)));
});

Deno.test("custom shapes", () => {
  const { shape: s, unknown } = customShape("name, email, iban, zip, nope, email");
  assertEquals(s.fields, ["full_name", "email", "iban", "postcode"]);
  assertEquals(unknown, ["nope"]);
});

Deno.test("writers", () => {
  const rows = [
    { id: 1, name: "O'Brien, Jr.", ok: true, note: null },
    { id: 2, name: 'Say "hi"', ok: false, note: "multi\nline" },
  ];
  assertEquals(
    render(rows, "csv"),
    'id,name,ok,note\n1,"O\'Brien, Jr.",true,\n2,"Say ""hi""",false,"multi\nline"',
  );
  assertEquals(render(rows, "csv-semicolon").split("\n")[1], "1;O'Brien, Jr.;true;");
  assertEquals(render(rows, "tsv").split("\n")[2], '2\tSay "hi"\tfalse\tmulti line');
  assertEquals(
    render(rows, "sql", "My Table"),
    "INSERT INTO my_table (id, name, ok, note) VALUES\n  (1, 'O''Brien, Jr.', TRUE, NULL),\n  (2, 'Say \"hi\"', FALSE, 'multi\nline');",
  );
  assertEquals(JSON.parse(render(rows, "json")), rows);
  assertEquals(render(rows, "jsonl").split("\n").map((l) => JSON.parse(l)), rows);
  assertEquals(render(rows, "markdown").split("\n")[0], "| id | name | ok | note |");
  assertEquals(render([], "sql"), "");
  const many = generate(shape("address")!, 1200, "en", "big", NOW);
  assertEquals(render(many, "sql", "addresses").match(/INSERT INTO/g)?.length, 3);
  assertEquals(csvCell(" padded "), '" padded "');
  assertEquals(sqlValue(3.5), "3.5");
  assertEquals(identifier("Clients – 2026"), "clients_2026");
  assertEquals(identifier("2026 data"), "_2026_data");
  assertEquals(identifier("!!!"), "records");
  assertEquals(FORMATS.length, 7);
});

Deno.test("row counts", () => {
  assertEquals(parseCount("25"), 25);
  assertEquals(parseCount("1 000"), 1000);
  assertEquals(parseCount("999999"), 10_000);
  assertEquals(parseCount("0"), 10);
  assertEquals(parseCount("abc", 5), 5);
});
