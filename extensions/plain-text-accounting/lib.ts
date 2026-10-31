// hledger, Ledger and Beancount output, amounts, reports and new entries, without the launcher.

export type EngineId = "hledger" | "ledger" | "beancount";

export interface Amount {
  commodity: string;
  quantity: number;
}

export interface Posting {
  account: string;
  amounts: Amount[];
}

export interface Txn {
  /** YYYY-MM-DD */
  date: string;
  status: "*" | "!" | "";
  code?: string;
  payee: string;
  note?: string;
  postings: Posting[];
}

export interface Balance {
  account: string;
  amounts: Amount[];
}

/** How a commodity is written: "$12.50" (left, no space) or "12.50 EUR". */
export interface Style {
  left: boolean;
  spaced: boolean;
  precision: number;
}
export type Styles = Map<string, Style>;

// --- Numbers and amounts -----------------------------------------------------

/** "1,234.56", "1.234,56", "-45.2", "1 234,5" → a number; NaN when it isn't one. */
export function parseNumber(text: string): number {
  let t = text.trim().replace(/[\s  ']/g, "");
  if (!/^[-+]?[\d.,]*\d[\d.,]*$/.test(t)) return NaN;
  const lastDot = t.lastIndexOf("."), lastComma = t.lastIndexOf(",");
  if (lastComma > lastDot) {
    // A decimal comma ("12,50", "1.234,56"), unless it groups thousands ("1,234").
    const decimals = t.length - lastComma - 1;
    t = lastDot >= 0 || decimals !== 3 ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else t = t.replace(/,/g, "");
  return Number(t);
}

/** Decimals written after the decimal mark, read the way parseNumber reads it. */
const decimalsOf = (text: string) => {
  const t = text.trim();
  const lastDot = t.lastIndexOf("."), lastComma = t.lastIndexOf(",");
  if (lastDot < 0 && lastComma < 0) return 0;
  if (lastComma > lastDot && lastDot < 0 && t.length - lastComma - 1 === 3) return 0; // "1,234"
  return t.length - Math.max(lastDot, lastComma) - 1;
};

/** A commodity written as a symbol before the number ("$", "€", "£", "R$"). */
export const isSymbol = (c: string) => /^[^\p{L}\d\s"]{1,2}$/u.test(c) || /^[A-Z]{1,2}[$]$/.test(c);

/**
 * Amounts in text as the tools print them: "$-45.20", "-45.20 EUR",
 * "1,000.00 USD, 2 VTI", "€12,50", `10 "AAPL"`; prices and costs after @ or { are dropped.
 */
export function parseAmounts(text: string, styles?: Styles): Amount[] {
  const out: Amount[] = [];
  for (const part0 of text.replace(/^\(|\)$/g, "").split(/,\s+(?=[-+]?[^\d\s,]|[-+]?\d)/)) {
    const part = part0.replace(/\s*(@@?|\{).*$/, "").trim();
    if (!part || part === "0") continue;
    const m = part.match(/^(-?)\s*([^\d\s.,-][^\d\s-]*|"[^"]+")?\s*(-?[\d][\d.,\s ']*)\s*([^\d\s.,][^\s]*|"[^"]+")?$/u);
    if (!m) continue;
    const commodity = (m[2] ?? m[4] ?? "").replace(/^"|"$/g, "");
    const num = m[3].trim();
    let quantity = parseNumber(num);
    if (isNaN(quantity)) continue;
    if (m[1] === "-") quantity = -quantity;
    out.push({ commodity, quantity });
    if (styles && !styles.has(commodity)) {
      styles.set(commodity, {
        left: !!m[2],
        spaced: !!m[2] && /^\S+\s/.test(part.replace(/^-/, "")),
        precision: decimalsOf(num),
      });
    } else if (styles) {
      const s = styles.get(commodity)!;
      s.precision = Math.max(s.precision, Math.min(decimalsOf(num), 8));
    }
  }
  return out;
}

/** Adds amounts by commodity, dropping the zeros. */
export function sumAmounts(...lists: Amount[][]): Amount[] {
  const m = new Map<string, number>();
  for (const list of lists) for (const a of list) m.set(a.commodity, (m.get(a.commodity) ?? 0) + a.quantity);
  return [...m].filter(([, q]) => Math.abs(q) > 1e-9).map(([commodity, quantity]) => ({ commodity, quantity }));
}

export const negate = (amounts: Amount[]) => amounts.map((a) => ({ ...a, quantity: -a.quantity }));

/** The style used when nothing was learned: "$12.50", "12.50 EUR". */
export function defaultStyle(commodity: string): Style {
  return { left: isSymbol(commodity), spaced: false, precision: 2 };
}

/** "$1,234.50", "-45.20 EUR", "3 VTI": as the journal writes it, with thousands separators. */
export function formatAmount(a: Amount, styles?: Styles, o: { grouping?: boolean } = {}): string {
  const style = styles?.get(a.commodity) ?? defaultStyle(a.commodity);
  const precision = Math.min(Math.max(style.precision, 0), 8);
  const abs = Math.abs(a.quantity).toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: Math.max(precision, Math.abs(a.quantity) < 1 && a.quantity !== 0 ? 4 : precision),
    useGrouping: o.grouping !== false,
  });
  const sign = a.quantity < -1e-9 ? "-" : "";
  const c = /[\s\d-]/.test(a.commodity) ? `"${a.commodity}"` : a.commodity;
  if (!c) return `${sign}${abs}`;
  return style.left ? `${sign}${c}${style.spaced ? " " : ""}${abs}` : `${sign}${abs} ${c}`;
}

export const formatAmounts = (amounts: Amount[], styles?: Styles) =>
  amounts.length ? amounts.map((a) => formatAmount(a, styles)).join(", ") : "0";

// --- hledger JSON ------------------------------------------------------------

/** One hledger Amount object: `{acommodity, aquantity: {decimalMantissa, decimalPlaces, floatingPoint}, astyle}`. */
export function hledgerAmount(o: any, styles?: Styles): Amount | undefined {
  if (!o || typeof o !== "object") return undefined;
  const q = o.aquantity;
  let quantity: number;
  if (q && typeof q === "object" && typeof q.decimalMantissa === "number" && typeof q.decimalPlaces === "number") {
    quantity = q.decimalMantissa / 10 ** q.decimalPlaces;
  } else if (q && typeof q === "object" && typeof q.floatingPoint === "number") quantity = q.floatingPoint;
  else if (typeof q === "number") quantity = q;
  else return undefined;
  const commodity = String(o.acommodity ?? "");
  if (styles && o.astyle && !styles.has(commodity)) {
    const p = o.astyle.asprecision;
    const precision = typeof p === "number"
      ? p
      : typeof p?.contents === "number"
      ? p.contents
      : typeof q?.decimalPlaces === "number"
      ? q.decimalPlaces
      : 2;
    styles.set(commodity, {
      left: o.astyle.ascommodityside === "L",
      spaced: !!o.astyle.ascommodityspaced,
      precision,
    });
  }
  return { commodity, quantity };
}

const mixed = (list: unknown, styles?: Styles): Amount[] =>
  Array.isArray(list) ? list.map((a) => hledgerAmount(a, styles)).filter((a): a is Amount => !!a) : [];

/** `hledger print -O json`: transactions with tdate, tstatus, tdescription, tpostings. */
export function parseHledgerPrint(json: string, styles?: Styles): Txn[] {
  const data = JSON.parse(json || "[]");
  if (!Array.isArray(data)) return [];
  return data.map((t: any): Txn => {
    const [payee, ...rest] = String(t.tdescription ?? "").split("|");
    const comment = String(t.tcomment ?? "").trim().split("\n")[0];
    return {
      date: String(t.tdate ?? ""),
      status: t.tstatus === "Cleared" ? "*" : t.tstatus === "Pending" ? "!" : "",
      code: t.tcode ? String(t.tcode) : undefined,
      payee: payee.trim(),
      note: rest.join("|").trim() || comment || undefined,
      postings: (Array.isArray(t.tpostings) ? t.tpostings : []).map((p: any) => ({
        account: String(p.paccount ?? ""),
        amounts: mixed(p.pamount, styles),
      })),
    };
  }).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date));
}

/**
 * `hledger balance -O json` (one period): `[[[fullName, shortName, indent, amounts], …], totalAmounts]`.
 */
export function parseHledgerBalance(json: string, styles?: Styles): Balance[] {
  const data = JSON.parse(json || "[]");
  const rows = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
  return rows
    .filter((r: unknown) => Array.isArray(r) && typeof r[0] === "string")
    .map((r: any[]) => ({ account: r[0], amounts: sumAmounts(mixed(r[3], styles)) }));
}

// --- CSV (ledger csv, bean-query -f csv) -------------------------------------

/** RFC 4180 rows: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

/** "(Budget:Food)" and "[Assets:Savings]" (virtual postings) → the account name. */
export const cleanAccount = (a: string) => a.trim().replace(/^[([](.*)[)\]]$/, "$1");

const isZero = (amounts: Amount[]) => sumAmounts(amounts).length === 0;

/**
 * Groups posting rows into transactions: consecutive rows with the same
 * date and payee, starting a new one when the previous one balanced.
 */
function group(
  rows: { date: string; status: Txn["status"]; code?: string; payee: string; note?: string; posting: Posting }[],
): Txn[] {
  const out: Txn[] = [];
  let cur: Txn | undefined;
  for (const r of rows) {
    const same = cur && cur.date === r.date && cur.payee === r.payee && cur.code === r.code &&
      !(cur.postings.length >= 2 && isZero(cur.postings.flatMap((p) => p.amounts)));
    if (!same) {
      cur = { date: r.date, status: r.status, code: r.code, payee: r.payee, note: r.note, postings: [] };
      out.push(cur);
    }
    cur!.postings.push(r.posting);
    if (r.status !== "*") cur!.status = cur!.status === "*" ? r.status : cur!.status;
    if (!cur!.note && r.note) cur!.note = r.note;
  }
  return out;
}

const isoDate = (d: string) =>
  d.trim().replace(/\//g, "-").replace(/^(\d{4})-(\d)-/, "$1-0$2-").replace(/-(\d)$/, "-0$1");

/**
 * `ledger csv` rows: date, code, payee, account, commodity, amount, cleared ("*", "!" or ""), note.
 */
export function parseLedgerCsv(text: string, styles?: Styles): Txn[] {
  const rows = parseCsv(text).filter((r) => r.length >= 6 && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(r[0].trim()));
  return group(rows.map((r) => {
    const amount = parseAmounts(
      isSymbol(r[4]) ? `${r[4]}${r[5]}` : `${r[5]} ${r[4]}`.trim(),
      styles,
    );
    return {
      date: isoDate(r[0]),
      status: (r[6] === "*" ? "*" : r[6] === "!" ? "!" : "") as Txn["status"],
      code: r[1] || undefined,
      payee: r[2].trim(),
      note: (r[7] ?? "").trim() || undefined,
      posting: { account: cleanAccount(r[3]), amounts: amount },
    };
  }));
}

/** Postings to balances by account, summed. */
export function balancesOf(txns: Txn[]): Balance[] {
  const m = new Map<string, Amount[][]>();
  for (const t of txns) {
    for (const p of t.postings) {
      if (!m.has(p.account)) m.set(p.account, []);
      m.get(p.account)!.push(p.amounts);
    }
  }
  return [...m].map(([account, lists]) => ({ account, amounts: sumAmounts(...lists) }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

/** `bean-query -f csv … "SELECT account, units(sum(position)) … GROUP BY account"`. */
export function parseBeanBalances(text: string, styles?: Styles): Balance[] {
  const rows = parseCsv(text);
  const start = rows[0] && /account/i.test(rows[0][0]) ? 1 : 0;
  return rows.slice(start).filter((r) => r.length >= 2 && /^[A-Z][\w-]*(:[\w-]+)*$/.test(r[0].trim()))
    .map((r) => ({ account: r[0].trim(), amounts: sumAmounts(parseAmounts(r.slice(1).join(", "), styles)) }));
}

/** `bean-query -f csv … "SELECT date, flag, payee, narration, account, units(position) …"`, grouped. */
export function parseBeanPostings(text: string, styles?: Styles): Txn[] {
  const rows = parseCsv(text).filter((r) => r.length >= 6 && /^\d{4}-\d{2}-\d{2}$/.test(r[0].trim()));
  return group(rows.map((r) => {
    const payee = r[2].trim(), narration = r[3].trim();
    return {
      date: r[0].trim(),
      status: (r[1].trim() === "*" ? "*" : r[1].trim() === "!" ? "!" : "") as Txn["status"],
      payee: payee || narration,
      note: payee ? narration || undefined : undefined,
      posting: { account: r[4].trim(), amounts: parseAmounts(r.slice(5).join(", "), styles) },
    };
  }));
}

// --- Command lines -----------------------------------------------------------

/** First day of the month `offset` months from `now`'s month, as YYYY-MM-DD. */
export function monthStart(now: Date, offset = 0): string {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return isoDay(d);
}

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function hledgerPrintArgs(file: string, from?: string): string[] {
  return ["-f", file, "print", "--explicit", "-O", "json", ...(from ? ["--begin", from] : [])];
}

/** Balances as `hledger balance` lists them; `depth` 1 gives the totals of Assets, Liabilities… */
export function hledgerBalanceArgs(file: string, depth?: number): string[] {
  return ["-f", file, "balance", "--flat", "--no-total", ...(depth ? ["--depth", String(depth)] : []), "-O", "json"];
}

export function ledgerCsvArgs(file: string, from?: string): string[] {
  return ["-f", file, "csv", "--date-format", "%Y-%m-%d", ...(from ? ["--begin", from] : [])];
}

export const BEAN_BALANCES = "SELECT account, units(sum(position)) AS balance GROUP BY account ORDER BY account";

export function beanPostingsQuery(from: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`Not a date: ${from}`);
  // No ORDER BY: postings come in journal order, those of a transaction together.
  return `SELECT date, flag, payee, narration, account, units(position) AS amount WHERE date >= ${from}`;
}

/** The engine for a journal: by its extension, else hledger when installed, else Ledger. */
export function chooseEngine(pref: string, file: string, hledgerInstalled: boolean): EngineId {
  const p = pref.trim().toLowerCase();
  if (p === "hledger" || p === "ledger" || p === "beancount") return p;
  if (/\.(beancount|bean)$/i.test(file)) return "beancount";
  return hledgerInstalled ? "hledger" : "ledger";
}

// --- Accounts and reports ----------------------------------------------------

export type Kind = "assets" | "liabilities" | "equity" | "income" | "expenses" | "other";

/** The kind of an account from its top level, in English, French and the usual variants. */
export function kindOf(account: string): Kind {
  const top = account.split(":")[0].toLowerCase();
  if (/^(assets?|actifs?|aktiva|activos?)$/.test(top)) return "assets";
  if (/^(liabilit(y|ies)|passifs?|debts?|dettes?|passiva|pasivos?)$/.test(top)) return "liabilities";
  if (/^(equity|capitaux|capital|eigenkapital|patrimonio)$/.test(top)) return "equity";
  if (/^(income|revenues?|revenus?|produits?|ertr[äa]ge|ingresos?)$/.test(top)) return "income";
  if (/^(expenses?|d[ée]penses?|charges?|aufwand|ausgaben|gastos?)$/.test(top)) return "expenses";
  return "other";
}

export const KIND_TITLES: Record<Kind, string> = {
  assets: "Assets",
  liabilities: "Liabilities",
  equity: "Equity",
  income: "Income",
  expenses: "Expenses",
  other: "Other",
};
const KIND_ORDER: Kind[] = ["assets", "liabilities", "equity", "income", "expenses", "other"];

/** Totals by top-level account (Assets, Liabilities…), in the usual order. */
export function totalsByKind(balances: Balance[]): { kind: Kind; top: string; amounts: Amount[] }[] {
  const m = new Map<string, Amount[][]>();
  for (const b of balances) {
    const top = b.account.split(":")[0];
    if (!m.has(top)) m.set(top, []);
    m.get(top)!.push(b.amounts);
  }
  return [...m].map(([top, lists]) => ({ kind: kindOf(top), top, amounts: sumAmounts(...lists) }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.top.localeCompare(b.top));
}

/** The accounts with a balance, sorted by kind then name. */
export function sortBalances(balances: Balance[]): Balance[] {
  return balances.filter((b) => b.amounts.length).sort((a, b) =>
    KIND_ORDER.indexOf(kindOf(a.account)) - KIND_ORDER.indexOf(kindOf(b.account)) ||
    a.account.localeCompare(b.account)
  );
}

/** "Expenses:Food:Groceries" at depth 2 → "Expenses:Food". */
export const atDepth = (account: string, depth: number) => account.split(":").slice(0, depth).join(":");

export interface Category {
  account: string;
  /** The amount in the main commodity. */
  total: number;
  /** Everything, other commodities included. */
  amounts: Amount[];
  /** Sub-accounts and their totals, biggest first. */
  children: { account: string; total: number }[];
  txns: Txn[];
}

/** The commodity most postings use: what totals and budgets are counted in. */
export function mainCommodity(txns: Txn[], fallback = ""): string {
  const m = new Map<string, number>();
  for (const t of txns) {
    for (const p of t.postings) for (const a of p.amounts) m.set(a.commodity, (m.get(a.commodity) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

/** Expenses between two days (from inclusive, to exclusive) by category at `depth`, biggest first. */
export function expensesByCategory(txns: Txn[], from: string, to: string, commodity: string, depth = 2): Category[] {
  const m = new Map<string, Category>();
  for (const t of txns) {
    if (t.date < from || t.date >= to) continue;
    for (const p of t.postings) {
      if (kindOf(p.account) !== "expenses") continue;
      const key = atDepth(p.account, depth);
      if (!m.has(key)) m.set(key, { account: key, total: 0, amounts: [], children: [], txns: [] });
      const c = m.get(key)!;
      c.amounts = sumAmounts(c.amounts, p.amounts);
      const q = p.amounts.filter((a) => a.commodity === commodity).reduce((s, a) => s + a.quantity, 0);
      c.total += q;
      const child = c.children.find((x) => x.account === p.account);
      if (child) child.total += q;
      else c.children.push({ account: p.account, total: q });
      if (!c.txns.includes(t)) c.txns.push(t);
    }
  }
  return [...m.values()].map((c) => ({ ...c, children: c.children.sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total || a.account.localeCompare(b.account));
}

/** The amount shown for a transaction: what went to expenses (or came from income), else its biggest posting. */
export function txnAmount(t: Txn): Amount[] {
  const pick = (k: Kind) => sumAmounts(...t.postings.filter((p) => kindOf(p.account) === k).map((p) => p.amounts));
  const exp = pick("expenses");
  if (exp.length) return exp;
  const inc = pick("income");
  if (inc.length) return negate(inc);
  const positive = sumAmounts(...t.postings.map((p) => p.amounts.filter((a) => a.quantity > 0)));
  return positive;
}

/** "Expenses:Food ← Assets:Checking": where the money went, from where. */
export function flow(t: Txn): string {
  const to = t.postings.filter((p) => p.amounts.some((a) => a.quantity > 0)).map((p) => p.account);
  const from = t.postings.filter((p) => p.amounts.some((a) => a.quantity < 0)).map((p) => p.account);
  const short = (list: string[]) => list.length > 2 ? `${list[0]} +${list.length - 1}` : list.join(", ");
  return from.length && to.length ? `${short(to)} ← ${short(from)}` : short(t.postings.map((p) => p.account));
}

/** "Today", "Yesterday", "Mon, Oct 26", "Oct 2, 2025", for sections. */
export function dayTitle(date: string, now: Date): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const diff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - day.getTime()) / 86_400_000,
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return day.toLocaleDateString("en-US", { weekday: "long" });
  return day.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(y !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

// --- New transactions --------------------------------------------------------

export interface NewTxn {
  date: string;
  payee: string;
  note?: string;
  amount: string;
  /** Where the money goes (an expense, or an asset for income). */
  to: string;
  /** Where it comes from. */
  from: string;
  cleared: boolean;
}

const ACCOUNT_RE = /^[^\s:;][^;]*?(:[^\s:;][^;:]*?)*$/;

/** "12.50", "12,50 €", "$12.50", "-3 EUR" → an amount, in `commodity` when none was typed. */
export function parseAmountInput(text: string, commodity: string): Amount {
  const [a] = parseAmounts(text.trim());
  if (!a || !isFinite(a.quantity) || a.quantity === 0) {
    throw new Error(`“${text.trim()}” is not an amount: write it like 12.50 or 12.50 ${commodity || "EUR"}`);
  }
  return { quantity: a.quantity, commodity: a.commodity || commodity };
}

/** Parses "today", "yesterday", "2026-10-30", "30/10" and "10-30" into YYYY-MM-DD. */
export function parseDateInput(text: string, now: Date): string {
  const t = text.trim().toLowerCase();
  if (!t || t === "today" || t === "aujourd'hui") return isoDay(now);
  if (t === "yesterday" || t === "hier") return isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return check(+m[1], +m[2], +m[3], text);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m) return check(now.getFullYear(), +m[1], +m[2], text);
  throw new Error(`“${text.trim()}” is not a date: write it like ${isoDay(now)}, today or yesterday`);
}

function check(y: number, m: number, d: number, text: string) {
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1 || date.getDate() !== d) throw new Error(`“${text.trim()}” is not a valid date`);
  return isoDay(date);
}

/** The entry appended to the journal, in the engine's syntax. */
export function formatTxn(n: NewTxn, engine: EngineId, commodity: string, styles?: Styles): string {
  const payee = n.payee.trim().replace(/\s+/g, " ");
  if (!payee) throw new Error("Write who you paid (or who paid you)");
  for (const acc of [n.to, n.from]) {
    if (!acc.trim() || !ACCOUNT_RE.test(acc.trim()) || /\s{2}|\t/.test(acc)) {
      throw new Error(`“${acc}” is not an account name: like Expenses:Food or Assets:Checking`);
    }
  }
  if (n.to.trim() === n.from.trim()) throw new Error("Pick two different accounts");
  const amount = parseAmountInput(n.amount, commodity);
  const note = (n.note ?? "").trim().replace(/\s+/g, " ");
  if (engine === "beancount") {
    if (!amount.commodity || !/^[A-Z][A-Z0-9'._-]*$/.test(amount.commodity)) {
      throw new Error("Beancount needs a currency like EUR or USD: set it in Settings, or type it after the amount");
    }
    const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const head = `${n.date} ${n.cleared ? "*" : "!"} ${q(payee)}${note ? ` ${q(note)}` : ""}`;
    const value = `${amount.quantity.toFixed(Math.max(2, decimalsOf(String(amount.quantity))))} ${amount.commodity}`;
    return `${head}\n  ${n.to.trim()}  ${value}\n  ${n.from.trim()}\n`;
  }
  const head = `${n.date}${n.cleared ? " *" : ""} ${payee.replace(/;/g, ",")}${note ? `  ; ${note}` : ""}`;
  const value = formatAmount(amount, styles, { grouping: false });
  return `${head}\n    ${n.to.trim()}  ${value}\n    ${n.from.trim()}\n`;
}

/** The journal with an entry appended after a blank line. */
export function appendTxn(journal: string, entry: string): string {
  if (!journal.trim()) return entry;
  const base = journal.replace(/\s*$/, "\n");
  return `${base}\n${entry}`;
}

/** A transaction written back as journal text, for the preview and copying. */
export function txnText(t: Txn, engine: EngineId, styles?: Styles): string {
  const width = Math.max(20, ...t.postings.map((p) => p.account.length)) + 2;
  if (engine === "beancount") {
    const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    const head = `${t.date} ${t.status || "*"} ${q(t.payee)}${t.note ? ` ${q(t.note)}` : ""}`;
    return [
      head,
      ...t.postings.flatMap((p) =>
        p.amounts.length
          ? p.amounts.map((a) => `  ${p.account.padEnd(width)}${a.quantity.toFixed(2)} ${a.commodity}`)
          : [`  ${p.account}`]
      ),
    ].join("\n");
  }
  const head = `${t.date}${t.status ? ` ${t.status}` : ""}${t.code ? ` (${t.code})` : ""} ${t.payee}${
    t.note ? `  ; ${t.note}` : ""
  }`;
  return [
    head,
    ...t.postings.flatMap((p) =>
      p.amounts.length
        ? p.amounts.map((a) => `    ${p.account.padEnd(width)}${formatAmount(a, styles, { grouping: false })}`)
        : [`    ${p.account}`]
    ),
  ].join("\n");
}

// --- Files -------------------------------------------------------------------

export const expandHome = (path: string, home: string) => path.replace(/^~(?=$|\/)/, home);
export const tildify = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

/** Journal names looked for in a folder, best first. */
export function journalRank(name: string): number {
  if (!/\.(journal|hledger|ledger|dat|beancount|bean)$/i.test(name)) return -1;
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  const i = ["main", "all", "ledger", "journal", "finances", "finance", "accounts", "personal", "household"].indexOf(
    base,
  );
  return i < 0 ? 100 : i;
}
