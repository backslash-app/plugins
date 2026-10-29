// A seeded random generator, checksums (Luhn, IBAN, RIB, SIREN/SIRET, VAT, NIR), the fields and record
// shapes, and the JSON, CSV and SQL writers. Pure and deterministic for a seed, tested in lib_test.ts.

import { CARD_BRANDS, type City, EN, FR, FR_BANKS, GB_BANKS, type LocaleData, LOREM } from "./data.ts";

// ---------------------------------------------------------------------------
// Seeded randomness

/** cyrb128: a string to four 32-bit seeds. */
function hashSeed(text: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/**
 * sfc32, seeded from any string: the same seed always gives the same data,
 * so tests and fixtures can be regenerated exactly.
 */
export class Rng {
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(seed: string) {
    [this.#a, this.#b, this.#c, this.#d] = hashSeed(seed);
    for (let i = 0; i < 12; i++) this.uint32();
  }

  uint32(): number {
    const t = (((this.#a + this.#b) | 0) + this.#d) | 0;
    this.#d = (this.#d + 1) | 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) | 0;
    this.#c = (this.#c << 21) | (this.#c >>> 11);
    this.#c = (this.#c + t) | 0;
    return t >>> 0;
  }

  /** [0, 1). */
  float(): number {
    return this.uint32() / 4294967296;
  }

  /** An integer in [min, max], both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.float() * items.length)];
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  digits(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) s += String(this.int(0, 9));
    return s;
  }
}

/** A short random seed to show, so a run can be reproduced. */
export function newSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Checksums

/** The Luhn check digit to append to `digits`. */
export function luhnDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function luhnValid(number: string): boolean {
  const s = number.replace(/\s/g, "");
  return /^\d{2,}$/.test(s) && luhnDigit(s.slice(0, -1)) === Number(s.at(-1));
}

/** Big numbers as text, modulo 97, as IBANs need. */
export function mod97(digits: string): number {
  let r = 0;
  for (let i = 0; i < digits.length; i += 7) r = Number(`${r}${digits.slice(i, i + 7)}`) % 97;
  return r;
}

const lettersToDigits = (s: string) => s.toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

/** The two check digits of an IBAN for a country and a BBAN (ISO 13616). */
export function ibanCheck(country: string, bban: string): string {
  return String(98 - mod97(lettersToDigits(`${bban}${country}00`))).padStart(2, "0");
}

export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  return mod97(lettersToDigits(s.slice(4) + s.slice(0, 4))) === 1;
}

/** `FR76 3000 4000 0312 3456 7890 143`. */
export const groupIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, "$1 ");

/** The RIB key of a French account (clé RIB): 97 − (89·bank + 15·branch + 3·account) mod 97. */
export function ribKey(bank: string, branch: string, account: string): string {
  // Letters in an account number count as digits: A, J → 1; B, K, S → 2; … I, R, Z → 9.
  const acc = account.toUpperCase().replace(
    /[A-Z]/g,
    (c) => String("123456789123456789234567890".charAt(c.charCodeAt(0) - 65)),
  );
  const r = (89 * Number(bank) + 15 * Number(branch) + 3 * Number(acc)) % 97;
  return String(97 - r).padStart(2, "0");
}

/** The French intracommunity VAT number of a SIREN: FR + key + SIREN. */
export function frVat(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${siren}`;
}

/** The key of a French social security number (NIR): 97 − (13 digits mod 97). */
export const nirKey = (nir13: string) => String(97 - mod97(nir13)).padStart(2, "0");

// ---------------------------------------------------------------------------
// Generators

export type Locale = "en" | "fr";
export const LOCALES: { value: Locale; title: string }[] = [
  { value: "en", title: "English (US)" },
  { value: "fr", title: "French (France)" },
];

export type Value = string | number | boolean | null;

interface Person {
  first: string;
  last: string;
  gender: "male" | "female";
}

interface Place {
  number: number;
  street: string;
  city: City;
  postcode: string;
}

/** What a row's fields share, so that the email matches the name and the city its postcode. */
export class Row {
  #person?: Person;
  #place?: Place;
  #company?: string;
  #siren?: string;
  constructor(readonly g: Faker) {}

  get person(): Person {
    return this.#person ??= this.g.person();
  }
  get place(): Place {
    return this.#place ??= this.g.place();
  }
  get company(): string {
    return this.#company ??= this.g.companyName();
  }
  get siren(): string {
    return this.#siren ??= this.g.siren();
  }
}

/** Accents and spaces out, for emails and usernames: "Hélène Lefèvre" → "helene", "lefevre". */
export const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export class Faker {
  readonly data: LocaleData;
  constructor(readonly rng: Rng, readonly locale: Locale, readonly now: number = Date.now()) {
    this.data = locale === "fr" ? FR : EN as unknown as LocaleData;
  }

  person(): Person {
    const gender = this.rng.chance(0.5) ? "male" : "female";
    return { first: this.rng.pick(this.data[gender]), last: this.rng.pick(this.data.last), gender };
  }

  place(): Place {
    const city = this.rng.pick(this.data.cities);
    return {
      number: this.rng.chance(0.85) ? this.rng.int(1, 120) : this.rng.int(121, 2500),
      street: `${this.rng.pick(this.data.streetTypes)} ${this.rng.pick(this.data.streetNames)}`,
      city,
      postcode: this.rng.pick(city.postcodes),
    };
  }

  street(p: Place): string {
    if (this.locale === "fr") {
      const bis = this.rng.chance(0.06) ? (this.rng.chance(0.7) ? " bis" : " ter") : "";
      return `${p.number}${bis} ${p.street}`;
    }
    const [type, ...name] = p.street.split(" ");
    return `${p.number} ${name.join(" ")} ${type}`;
  }

  fullAddress(p: Place): string {
    return this.locale === "fr"
      ? `${this.street(p)}, ${p.postcode} ${p.city.name}`
      : `${this.street(p)}, ${p.city.name}, ${p.city.area} ${p.postcode}`;
  }

  email(p: Person, domain?: string): string {
    const f = slug(p.first), l = slug(p.last);
    const style = this.rng.int(0, 4);
    const local = style === 0
      ? `${f}.${l}`
      : style === 1
      ? `${f[0]}${l}`
      : style === 2
      ? `${f}${this.rng.int(1, 99)}`
      : style === 3
      ? `${f}_${l}`
      : `${f}.${l}${this.rng.int(1, 9)}`;
    return `${local}@${domain ?? this.rng.pick(this.data.emailDomains)}`;
  }

  username(p: Person): string {
    const f = slug(p.first), l = slug(p.last);
    return this.rng.pick([`${f}${l[0]}`, `${f}_${l}`, `${f[0]}${l}${this.rng.int(1, 99)}`, `${l}${f[0]}`]);
  }

  /**
   * Numbers that can't ring anyone: in France the ranges ARCEP reserves for
   * films and books (01 99 00, 02 61 91, 03 53 01, 04 65 71, 05 36 49,
   * 06 39 98), in the US 555-0100 to 555-0199.
   */
  phone(mobile = this.rng.chance(0.5)): string {
    if (this.locale === "fr") {
      const prefix = mobile ? "06 39 98" : this.rng.pick(["01 99 00", "02 61 91", "03 53 01", "04 65 71", "05 36 49"]);
      return `${prefix} ${this.rng.digits(2)} ${this.rng.digits(2)}`;
    }
    return `(${this.rng.pick(["201", "212", "305", "312", "415", "512", "617", "702", "818", "917"])}) 555-01${
      this.rng.digits(2)
    }`;
  }

  /** The same number, international: +33 6 39 98 12 34, +1 212-555-0123. */
  intlPhone(phone: string): string {
    if (this.locale === "fr") return `+33 ${phone.slice(1)}`;
    const m = /^\((\d{3})\) (\d{3})-(\d{4})$/.exec(phone);
    return m ? `+1 ${m[1]}-${m[2]}-${m[3]}` : phone;
  }

  companyName(): string {
    const d = this.data;
    const pattern = this.rng.pick(d.companyPatterns);
    const name = pattern
      .replace(/\{last\}/g, () => this.rng.pick(d.last))
      .replace(/\{word\}/g, () => this.rng.pick(d.companyWords))
      .replace(/\{adj\}/g, () => this.rng.pick(d.companyAdjectives ?? d.companyWords))
      .replace(/\{place\}/g, () => this.rng.pick(d.cities).name);
    return this.rng.chance(0.6) ? `${name} ${this.rng.pick(d.companySuffixes)}` : name;
  }

  website(company: string): string {
    const words = company.split(/[\s&,]+/).map(slug).filter((w) =>
      w && !["sas", "sarl", "sa", "eurl", "sasu", "inc", "llc", "corp", "ltd", "co", "et", "and", "group"].includes(w)
    );
    return `https://www.${words.slice(0, 2).join("-") || "company"}.example`;
  }

  /** A SIREN: 8 random digits and a Luhn check digit. */
  siren(): string {
    const body = String(this.rng.int(1, 9)) + this.rng.digits(7);
    return body + luhnDigit(body);
  }

  /** A SIRET: the SIREN, a 4-digit NIC, and a check digit making all 14 digits pass Luhn. */
  siret(siren: string): string {
    const nic = this.rng.chance(0.7) ? `000${this.rng.int(1, 9)}` : pad(this.rng.int(10, 999), 4);
    const body = siren + nic;
    return body + luhnDigit(body);
  }

  iban(): string {
    if (this.locale === "fr") {
      const bank = this.rng.pick(FR_BANKS), branch = this.rng.digits(5), account = this.rng.digits(11);
      const bban = `${bank}${branch}${account}${ribKey(bank, branch, account)}`;
      return `FR${ibanCheck("FR", bban)}${bban}`;
    }
    // The US has no IBAN; English data uses British ones.
    const bban = `${this.rng.pick(GB_BANKS)}${this.rng.digits(6)}${this.rng.digits(8)}`;
    return `GB${ibanCheck("GB", bban)}${bban}`;
  }

  bic(iban: string): string {
    const country = iban.slice(0, 2);
    if (country === "FR") {
      const bank = iban.slice(4, 9);
      const codes: Record<string, string> = {
        "30004": "BNPAFRPP",
        "30003": "SOGEFRPP",
        "10107": "BREDFRPP",
        "20041": "PSSTFRPP",
        "30066": "CMCIFRPP",
        "10278": "CMCIFR2A",
        "11306": "AGRIFRPP",
        "16958": "QNTOFRP1",
        "17515": "CEPAFRPP",
        "18206": "AGRIFRPP",
      };
      return codes[bank] ?? "BNPAFRPP";
    }
    const codes: Record<string, string> = {
      NWBK: "NWBKGB2L",
      BARC: "BARCGB22",
      LOYD: "LOYDGB2L",
      HBUK: "HBUKGB4B",
      MIDL: "MIDLGB22",
      RBOS: "RBOSGB2L",
      MONZ: "MONZGB2L",
      SRLG: "SRLGGB2L",
    };
    return codes[iban.slice(4, 8)] ?? "NWBKGB2L";
  }

  /** A card number from a published test range, with a valid Luhn digit. */
  card(brand?: string): { brand: string; number: string; expiry: string; cvc: string } {
    const b = CARD_BRANDS.find((c) => c.brand === brand) ?? this.rng.pick(CARD_BRANDS);
    const prefix = this.rng.pick(b.prefixes);
    const body = prefix + this.rng.digits(b.length - prefix.length - 1);
    const d = new Date(this.now);
    const months = this.rng.int(3, 60);
    const exp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
    return {
      brand: b.brand,
      number: body + luhnDigit(body),
      expiry: `${pad(exp.getUTCMonth() + 1)}/${String(exp.getUTCFullYear()).slice(2)}`,
      cvc: this.rng.digits(b.cvc),
    };
  }

  /** A French social security number (NIR) with its key, for a person born on `birth`. */
  nir(p: Person, birth: string): string {
    const city = this.rng.pick(FR.cities);
    const dept = city.postcodes[0].slice(0, 2);
    const commune = pad(this.rng.int(1, 400), 3);
    const body = `${p.gender === "male" ? 1 : 2}${birth.slice(2, 4)}${birth.slice(5, 7)}${
      dept === "20" ? "19" : dept
    }${commune}${pad(this.rng.int(1, 999), 3)}`;
    return `${body}${nirKey(body)}`;
  }

  /** A day between `fromDays` and `toDays` days from now (negative is the past). */
  date(fromDays: number, toDays: number): string {
    return isoDate(this.now + this.rng.int(fromDays, toDays) * DAY);
  }

  /** An instant in the last `days` days: `2026-03-14T09:26:53Z`. */
  timestamp(days: number): string {
    return new Date(this.now - this.rng.int(0, days * DAY / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  birthdate(minAge = 18, maxAge = 80): string {
    return this.date(-maxAge * 365, -minAge * 365 - 1);
  }

  uuid(): string {
    const h = Array.from({ length: 4 }, () => this.rng.uint32().toString(16).padStart(8, "0")).join("");
    const variant = "89ab"[this.rng.int(0, 3)];
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  /** Addresses of the documentation and private ranges: they never point at someone's machine. */
  ipv4(): string {
    const r = this.rng;
    return r.pick([
      () => `192.0.2.${r.int(1, 254)}`,
      () => `198.51.100.${r.int(1, 254)}`,
      () => `203.0.113.${r.int(1, 254)}`,
      () => `10.${r.int(0, 255)}.${r.int(0, 255)}.${r.int(1, 254)}`,
      () => `192.168.${r.int(0, 255)}.${r.int(1, 254)}`,
      () => `172.${r.int(16, 31)}.${r.int(0, 255)}.${r.int(1, 254)}`,
    ])();
  }

  /** In 2001:db8::/32, the IPv6 documentation prefix. */
  ipv6(): string {
    const group = () => this.rng.int(0, 0xffff).toString(16);
    return `2001:db8:${Array.from({ length: 6 }, group).join(":")}`;
  }

  /** A locally administered unicast MAC address. */
  mac(): string {
    const bytes = Array.from({ length: 6 }, () => this.rng.int(0, 255));
    bytes[0] = (bytes[0] | 0x02) & 0xfe;
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
  }

  words(n: number): string {
    return Array.from({ length: n }, () => this.rng.pick(LOREM)).join(" ");
  }

  sentence(): string {
    const s = this.words(this.rng.int(6, 14));
    return `${s[0].toUpperCase()}${s.slice(1)}.`;
  }

  paragraph(): string {
    return Array.from({ length: this.rng.int(3, 6) }, () => this.sentence()).join(" ");
  }

  password(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_";
    return Array.from({ length: 16 }, () => chars[this.rng.int(0, chars.length - 1)]).join("");
  }

  money(min: number, max: number): number {
    return Math.round((min + this.rng.float() * (max - min)) * 100) / 100;
  }
}

// ---------------------------------------------------------------------------
// Fields

export interface FieldDef {
  id: string;
  title: string;
  group: string;
  gen: (row: Row, g: Faker) => Value;
}

const F = (id: string, title: string, group: string, gen: FieldDef["gen"]): FieldDef => ({ id, title, group, gen });

export const FIELDS: FieldDef[] = [
  F("id", "Sequential id", "Identifiers", () => null), // filled by the generator: 1, 2, 3…
  F("uuid", "UUID v4", "Identifiers", (_r, g) => g.uuid()),
  F("first_name", "First name", "Person", (r) => r.person.first),
  F("last_name", "Last name", "Person", (r) => r.person.last),
  F("full_name", "Full name", "Person", (r) => `${r.person.first} ${r.person.last}`),
  F("gender", "Gender", "Person", (r) => r.person.gender === "male" ? "M" : "F"),
  F("email", "Email", "Person", (r, g) => g.email(r.person)),
  F("username", "Username", "Person", (r, g) => g.username(r.person)),
  F("phone", "Phone number", "Person", (_r, g) => g.phone()),
  F("mobile", "Mobile number", "Person", (_r, g) => g.phone(true)),
  F("phone_intl", "Phone (international)", "Person", (_r, g) => g.intlPhone(g.phone())),
  F("birthdate", "Birth date", "Person", (_r, g) => g.birthdate()),
  F("age", "Age", "Person", (_r, g) => g.rng.int(18, 80)),
  F("job_title", "Job title", "Person", (_r, g) => g.rng.pick(g.data.jobs)),
  F("password", "Password", "Person", (_r, g) => g.password()),
  F("street", "Street address", "Address", (r, g) => g.street(r.place)),
  F("postcode", "Postcode / ZIP", "Address", (r) => r.place.postcode),
  F("city", "City", "Address", (r) => r.place.city.name),
  F("state", "Department / state", "Address", (r) => r.place.city.area),
  F("region", "Region", "Address", (r) => r.place.city.region),
  F("country", "Country", "Address", (_r, g) => g.data.country),
  F("address", "Full address", "Address", (r, g) => g.fullAddress(r.place)),
  F("company", "Company name", "Company", (r) => r.company),
  F("website", "Website", "Company", (r, g) => g.website(r.company)),
  F("company_email", "Company email", "Company", (r, g) => `contact@${g.website(r.company).slice(12)}`),
  F("siren", "SIREN (Luhn)", "Company", (r) => r.siren),
  F("siret", "SIRET (Luhn)", "Company", (r, g) => g.siret(r.siren)),
  F("vat_number", "VAT number (FR)", "Company", (r) => frVat(r.siren)),
  F("department", "Department", "Company", (_r, g) => g.rng.pick(g.data.departments)),
  F("iban", "IBAN (valid checksum)", "Finance", (_r, g) => g.iban()),
  F("bic", "BIC", "Finance", (_r, g) => g.bic(g.iban())),
  F("card_number", "Test card number", "Finance", (_r, g) => g.card().number),
  F("card_brand", "Card brand", "Finance", (_r, g) => g.rng.pick(CARD_BRANDS).brand),
  F("card_expiry", "Card expiry", "Finance", (_r, g) => g.card().expiry),
  F("card_cvc", "Card CVC", "Finance", (_r, g) => g.rng.digits(3)),
  F("amount", "Amount", "Finance", (_r, g) => g.money(5, 500)),
  F("currency", "Currency", "Finance", (_r, g) => g.locale === "fr" ? "EUR" : g.rng.pick(["USD", "USD", "EUR", "GBP"])),
  F("nir", "Social security number (FR NIR)", "Person", (r, g) => g.nir(r.person, g.birthdate())),
  F("date", "Date (last year)", "Dates", (_r, g) => g.date(-365, 0)),
  F("future_date", "Date (next year)", "Dates", (_r, g) => g.date(1, 365)),
  F("created_at", "Timestamp (last 2 years)", "Dates", (_r, g) => g.timestamp(730)),
  F("unix_time", "Unix timestamp", "Dates", (_r, g) => Math.floor(Date.parse(g.timestamp(730)) / 1000)),
  F("ipv4", "IPv4 address", "Internet", (_r, g) => g.ipv4()),
  F("ipv6", "IPv6 address", "Internet", (_r, g) => g.ipv6()),
  F("mac", "MAC address", "Internet", (_r, g) => g.mac()),
  F("url", "URL", "Internet", (_r, g) => `https://example.com/${g.words(2).replace(" ", "-")}`),
  F("color", "Hex color", "Internet", (_r, g) => `#${g.rng.int(0, 0xffffff).toString(16).padStart(6, "0")}`),
  F("boolean", "Boolean", "Other", (_r, g) => g.rng.chance(0.5)),
  F("integer", "Integer (1–1000)", "Other", (_r, g) => g.rng.int(1, 1000)),
  F("word", "Word", "Text", (_r, g) => g.words(1)),
  F("sentence", "Sentence", "Text", (_r, g) => g.sentence()),
  F("paragraph", "Paragraph", "Text", (_r, g) => g.paragraph()),
  F("product", "Product", "Commerce", (_r, g) => g.rng.pick(g.data.products)),
  F("quantity", "Quantity", "Commerce", (_r, g) => g.rng.int(1, 5)),
  F(
    "status",
    "Order status",
    "Commerce",
    (_r, g) => g.rng.pick(["pending", "paid", "shipped", "delivered", "cancelled"]),
  ),
];

export const field = (id: string) => FIELDS.find((f) => f.id === id);

// ---------------------------------------------------------------------------
// Record shapes

export interface Shape {
  id: string;
  title: string;
  /** SQL table name. */
  table: string;
  fields: string[];
  /** Columns computed from the others. */
  derive?: (rec: Record<string, Value>, g: Faker, row: Row) => void;
}

export const SHAPES: Shape[] = [
  {
    id: "person",
    title: "People",
    table: "people",
    fields: ["id", "first_name", "last_name", "email", "phone", "birthdate", "city"],
  },
  {
    id: "user",
    title: "User accounts",
    table: "users",
    fields: ["id", "uuid", "username", "email", "full_name", "created_at", "ipv4", "boolean"],
    derive: (rec) => {
      rec.is_active = rec.boolean;
      delete rec.boolean;
    },
  },
  {
    id: "customer",
    title: "Customers with address",
    table: "customers",
    fields: ["id", "full_name", "email", "phone", "street", "postcode", "city", "country", "created_at"],
  },
  {
    id: "address",
    title: "Addresses",
    table: "addresses",
    fields: ["id", "street", "postcode", "city", "state", "region", "country"],
  },
  {
    id: "company",
    title: "Companies (SIREN, SIRET, VAT, IBAN)",
    table: "companies",
    fields: ["id", "company", "siren", "siret", "vat_number", "iban", "phone", "company_email", "website", "address"],
  },
  {
    id: "employee",
    title: "Employees",
    table: "employees",
    fields: ["id", "first_name", "last_name", "email", "job_title", "department", "date", "integer"],
    derive: (rec, g) => {
      rec.hire_date = g.date(-3650, -30);
      rec.salary = g.locale === "fr" ? g.rng.int(24, 90) * 1000 : g.rng.int(40, 180) * 1000;
      delete rec.date;
      delete rec.integer;
    },
  },
  {
    id: "bank",
    title: "Bank accounts",
    table: "bank_accounts",
    fields: ["id", "full_name", "iban"],
    derive: (rec, g) => {
      rec.bic = g.bic(String(rec.iban));
      rec.iban_formatted = groupIban(String(rec.iban));
    },
  },
  {
    id: "card",
    title: "Test payment cards",
    table: "cards",
    fields: ["id", "full_name"],
    derive: (rec, g) => {
      const c = g.card();
      rec.cardholder = String(rec.full_name).toUpperCase();
      delete rec.full_name;
      Object.assign(rec, { brand: c.brand, number: c.number, expiry: c.expiry, cvc: c.cvc });
    },
  },
  {
    id: "order",
    title: "Orders",
    table: "orders",
    fields: ["id", "uuid", "email", "product", "quantity", "currency", "status", "created_at"],
    derive: (rec, g) => {
      const unit = g.money(4, 250);
      rec.unit_price = unit;
      rec.total = Math.round(unit * Number(rec.quantity) * 100) / 100;
    },
  },
  {
    id: "network",
    title: "Network devices",
    table: "devices",
    fields: ["id", "uuid", "ipv4", "ipv6", "mac", "created_at"],
    derive: (rec, g) => {
      rec.hostname = `${g.rng.pick(["web", "db", "cache", "worker", "api", "edge"])}-${pad(g.rng.int(1, 40))}.internal`;
    },
  },
  {
    id: "french",
    title: "French identity (NIR, IBAN, address)",
    table: "personnes",
    fields: [
      "id",
      "first_name",
      "last_name",
      "gender",
      "birthdate",
      "email",
      "mobile",
      "street",
      "postcode",
      "city",
      "iban",
    ],
    derive: (rec, g, row) => {
      rec.nir = g.nir(row.person, String(rec.birthdate));
    },
  },
  {
    id: "post",
    title: "Blog posts (lorem)",
    table: "posts",
    fields: ["id", "uuid", "sentence", "paragraph", "full_name", "created_at", "boolean"],
    derive: (rec) => {
      rec.title = String(rec.sentence).replace(/\.$/, "");
      rec.body = rec.paragraph;
      rec.author = rec.full_name;
      rec.published = rec.boolean;
      for (const k of ["sentence", "paragraph", "full_name", "boolean"]) delete rec[k];
    },
  },
];

export const shape = (id: string) => SHAPES.find((s) => s.id === id);

/** A custom shape from `name, email, iban`: unknown names are reported, not dropped silently. */
export function customShape(spec: string): { shape: Shape; unknown: string[] } {
  const names = spec.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const aliases: Record<string, string> = {
    name: "full_name",
    firstname: "first_name",
    lastname: "last_name",
    zip: "postcode",
    zipcode: "postcode",
    postal_code: "postcode",
    tel: "phone",
    telephone: "phone",
    ip: "ipv4",
    guid: "uuid",
    card: "card_number",
    lorem: "sentence",
    text: "paragraph",
    bool: "boolean",
    int: "integer",
    number: "integer",
  };
  const fields: string[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const id = aliases[n] ?? n;
    if (field(id)) {
      if (!fields.includes(id)) fields.push(id);
    } else unknown.push(n);
  }
  return { shape: { id: "custom", title: "Custom", table: "records", fields }, unknown };
}

/** `count` records of a shape, the same for the same seed, locale and `now`. */
export function generate(
  s: Shape,
  count: number,
  locale: Locale,
  seed: string,
  now = Date.now(),
): Record<string, Value>[] {
  const g = new Faker(new Rng(`${seed}:${locale}:${s.id}`), locale, now);
  const out: Record<string, Value>[] = [];
  for (let i = 0; i < count; i++) {
    const row = new Row(g);
    const rec: Record<string, Value> = {};
    for (const id of s.fields) rec[id] = id === "id" ? i + 1 : field(id)!.gen(row, g);
    s.derive?.(rec, g, row);
    out.push(rec);
  }
  return out;
}

/** One value of one field, for the quick list. */
export function sample(id: string, locale: Locale, seed: string, now = Date.now()): Value {
  const g = new Faker(new Rng(`${seed}:${locale}:${id}`), locale, now);
  if (id === "id") return 1;
  return field(id)!.gen(new Row(g), g);
}

// ---------------------------------------------------------------------------
// Output

export type Format = "json" | "jsonl" | "csv" | "csv-semicolon" | "tsv" | "sql" | "markdown";

export const FORMATS: { value: Format; title: string; ext: string }[] = [
  { value: "json", title: "JSON", ext: "json" },
  { value: "jsonl", title: "JSON Lines", ext: "jsonl" },
  { value: "csv", title: "CSV", ext: "csv" },
  { value: "csv-semicolon", title: "CSV with ; (Excel in French)", ext: "csv" },
  { value: "tsv", title: "TSV", ext: "tsv" },
  { value: "sql", title: "SQL INSERT", ext: "sql" },
  { value: "markdown", title: "Markdown table", ext: "md" },
];

const columns = (rows: Record<string, Value>[]) => [...new Set(rows.flatMap((r) => Object.keys(r)))];

/** RFC 4180: quoted when it holds the separator, a quote, a line break or edge spaces. */
export function csvCell(v: Value, sep = ","): string {
  if (v === null) return "";
  const s = String(v);
  return s.includes(sep) || /["\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sqlValue(v: Value): string {
  if (v === null) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

/** Lowercase snake_case, as a SQL identifier needs no quoting. */
export function identifier(name: string, fallback = "records"): string {
  const id = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return !id ? fallback : /^\d/.test(id) ? `_${id}` : id;
}

export function render(rows: Record<string, Value>[], format: Format, table = "records"): string {
  const cols = columns(rows);
  switch (format) {
    case "json":
      return JSON.stringify(rows, null, 2);
    case "jsonl":
      return rows.map((r) => JSON.stringify(r)).join("\n");
    case "csv":
    case "csv-semicolon":
    case "tsv": {
      const sep = format === "csv" ? "," : format === "tsv" ? "\t" : ";";
      const cell = (v: Value) => format === "tsv" ? String(v ?? "").replace(/[\t\r\n]+/g, " ") : csvCell(v, sep);
      return [cols.join(sep), ...rows.map((r) => cols.map((c) => cell(r[c] ?? null)).join(sep))].join("\n");
    }
    case "sql": {
      if (!rows.length) return "";
      const t = identifier(table);
      // Multi-row INSERTs (PostgreSQL, MySQL, SQLite, SQL Server 2008+), 500 rows each.
      const chunks: string[] = [];
      for (let i = 0; i < rows.length; i += 500) {
        const values = rows.slice(i, i + 500).map((r) => `  (${cols.map((c) => sqlValue(r[c] ?? null)).join(", ")})`);
        chunks.push(`INSERT INTO ${t} (${cols.join(", ")}) VALUES\n${values.join(",\n")};`);
      }
      return chunks.join("\n\n");
    }
    case "markdown": {
      const esc = (v: Value) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      return [
        `| ${cols.join(" | ")} |`,
        `| ${cols.map(() => "---").join(" | ")} |`,
        ...rows.map((r) => `| ${cols.map((c) => esc(r[c] ?? null)).join(" | ")} |`),
      ].join("\n");
    }
  }
}

/** A row count from the form: 1 to 10,000. */
export function parseCount(text: string | undefined, fallback = 10): number {
  const n = Number(String(text ?? "").replace(/[\s_,]/g, ""));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(10_000, Math.floor(n));
}

/** Known test card numbers from processors' documentation, which sandboxes accept as they are. */
export const KNOWN_TEST_CARDS: { brand: string; number: string; note: string }[] = [
  { brand: "Visa", number: "4242424242424242", note: "Stripe: succeeds" },
  { brand: "Visa", number: "4111111111111111", note: "Braintree, Adyen and most sandboxes" },
  { brand: "Visa (debit)", number: "4000056655665556", note: "Stripe" },
  { brand: "Visa", number: "4000000000000002", note: "Stripe: declined" },
  { brand: "Visa", number: "4000002500003155", note: "Stripe: requires 3-D Secure" },
  { brand: "Mastercard", number: "5555555555554444", note: "Stripe" },
  { brand: "Mastercard (2-series)", number: "2223003122003222", note: "Stripe" },
  { brand: "American Express", number: "378282246310005", note: "Stripe" },
  { brand: "Discover", number: "6011111111111117", note: "Stripe" },
  { brand: "JCB", number: "3566002020360505", note: "Stripe" },
  { brand: "Diners Club", number: "3056930009020004", note: "Stripe" },
  { brand: "UnionPay", number: "6200000000000005", note: "Stripe" },
];

/** `4242 4242 4242 4242`, Amex as `3782 822463 10005`. */
export function groupCard(number: string): string {
  if (number.length === 15) return `${number.slice(0, 4)} ${number.slice(4, 10)} ${number.slice(10)}`;
  return number.replace(/(.{4})(?=.)/g, "$1 ");
}
