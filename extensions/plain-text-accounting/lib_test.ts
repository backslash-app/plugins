import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  appendTxn,
  atDepth,
  balancesOf,
  beanPostingsQuery,
  chooseEngine,
  dayTitle,
  expensesByCategory,
  flow,
  formatAmount,
  formatAmounts,
  formatTxn,
  hledgerBalanceArgs,
  hledgerPrintArgs,
  journalRank,
  kindOf,
  ledgerCsvArgs,
  mainCommodity,
  monthStart,
  parseAmountInput,
  parseAmounts,
  parseBeanBalances,
  parseBeanPostings,
  parseCsv,
  parseDateInput,
  parseHledgerBalance,
  parseHledgerPrint,
  parseLedgerCsv,
  parseNumber,
  sortBalances,
  type Styles,
  sumAmounts,
  totalsByKind,
  txnAmount,
  txnText,
} from "./lib.ts";
import { ALLOWED } from "./engine.ts";

const NOW = new Date(2026, 9, 28, 12, 0); // Wednesday Oct 28 2026

const usd = (cents: number) => ({
  acommodity: "$",
  aprice: null,
  aquantity: { decimalMantissa: cents, decimalPlaces: 2, floatingPoint: cents / 100 },
  astyle: {
    ascommodityside: "L",
    ascommodityspaced: false,
    asdecimalmark: ".",
    asdigitgroups: null,
    asprecision: 2,
    asrounding: "NoRounding",
  },
});
const posting = (account: string, amount: unknown[]) => ({
  paccount: account,
  pamount: amount,
  pbalanceassertion: null,
  pcomment: "",
  pdate: null,
  pstatus: "Unmarked",
  ptags: [],
  ptype: "RegularPosting",
});
const HLEDGER_PRINT = JSON.stringify([
  {
    tcode: "",
    tcomment: "",
    tdate: "2026-09-29",
    tdate2: null,
    tdescription: "Grocery Store",
    tindex: 1,
    tpostings: [posting("expenses:food:groceries", [usd(3010)]), posting("assets:bank:checking", [usd(-3010)])],
    tstatus: "Cleared",
    ttags: [],
  },
  {
    tcode: "",
    tcomment: "",
    tdate: "2026-10-02",
    tdescription: "ACME Corp | October salary",
    tindex: 2,
    tpostings: [posting("assets:bank:checking", [usd(320000)]), posting("income:salary", [usd(-320000)])],
    tstatus: "Cleared",
    ttags: [],
  },
  {
    tcode: "1042",
    tcomment: "weekly shop\n",
    tdate: "2026-10-26",
    tdescription: "Grocery Store",
    tindex: 3,
    tpostings: [
      posting("expenses:food:groceries", [usd(4520)]),
      posting("expenses:household", [usd(1250)]),
      posting("liabilities:visa", [usd(-5770)]),
    ],
    tstatus: "Pending",
    ttags: [],
  },
  {
    tcode: "",
    tcomment: "",
    tdate: "2026-10-27",
    tdescription: "Le Bistro",
    tindex: 4,
    tpostings: [
      posting("expenses:food:restaurants", [usd(2800)]),
      posting("assets:bank:checking", [{ ...usd(-2800), aquantity: { floatingPoint: -28 } }]),
    ],
    tstatus: "Unmarked",
    ttags: [],
  },
]);

Deno.test("numbers in every notation", () => {
  assertEquals(parseNumber("1,234.56"), 1234.56);
  assertEquals(parseNumber("1.234,56"), 1234.56);
  assertEquals(parseNumber("12,50"), 12.5);
  assertEquals(parseNumber("1,234"), 1234);
  assertEquals(parseNumber("1 234,5"), 1234.5);
  assertEquals(parseNumber("-45.2"), -45.2);
  assert(isNaN(parseNumber("abc")));
});

Deno.test("amounts as the tools print them", () => {
  assertEquals(parseAmounts("$-45.20"), [{ commodity: "$", quantity: -45.2 }]);
  assertEquals(parseAmounts("-$45.20"), [{ commodity: "$", quantity: -45.2 }]);
  assertEquals(parseAmounts("-45.20 EUR"), [{ commodity: "EUR", quantity: -45.2 }]);
  assertEquals(parseAmounts("1,000.00 USD, 2 VTI"), [{ commodity: "USD", quantity: 1000 }, {
    commodity: "VTI",
    quantity: 2,
  }]);
  assertEquals(parseAmounts("10 VTI {200.00 USD}"), [{ commodity: "VTI", quantity: 10 }]);
  assertEquals(parseAmounts("€12,50"), [{ commodity: "€", quantity: 12.5 }]);
  assertEquals(parseAmounts('3 "AAPL 2"'), [{ commodity: "AAPL 2", quantity: 3 }]);
  assertEquals(parseAmounts("(100.00 USD)"), [{ commodity: "USD", quantity: 100 }]);
  assertEquals(parseAmounts("0"), []);
  assertEquals(parseAmounts("12.5"), [{ commodity: "", quantity: 12.5 }]);
  const styles: Styles = new Map();
  parseAmounts("$1,234.567", styles);
  parseAmounts("12.50 EUR", styles);
  assertEquals(styles.get("$"), { left: true, spaced: false, precision: 3 });
  assertEquals(styles.get("EUR"), { left: false, spaced: false, precision: 2 });
});

Deno.test("formatting amounts", () => {
  assertEquals(formatAmount({ commodity: "$", quantity: -1234.5 }), "-$1,234.50");
  assertEquals(formatAmount({ commodity: "EUR", quantity: 12.5 }), "12.50 EUR");
  assertEquals(
    formatAmount({ commodity: "VTI", quantity: 3 }, new Map([["VTI", { left: false, spaced: true, precision: 0 }]])),
    "3 VTI",
  );
  assertEquals(formatAmount({ commodity: "$", quantity: 1234.5 }, undefined, { grouping: false }), "$1234.50");
  assertEquals(formatAmount({ commodity: "AAPL 2", quantity: 1 }), '1.00 "AAPL 2"');
  assertEquals(formatAmounts([]), "0");
  assertEquals(sumAmounts([{ commodity: "$", quantity: 1 }], [{ commodity: "$", quantity: -1 }]), []);
});

Deno.test("hledger print JSON", () => {
  const styles: Styles = new Map();
  const txns = parseHledgerPrint(HLEDGER_PRINT, styles);
  assertEquals(txns.length, 4);
  assertEquals(txns[1].payee, "ACME Corp");
  assertEquals(txns[1].note, "October salary");
  assertEquals(txns[2].status, "!");
  assertEquals(txns[2].code, "1042");
  assertEquals(txns[2].note, "weekly shop");
  assertEquals(txns[3].postings[1].amounts, [{ commodity: "$", quantity: -28 }]); // floatingPoint only
  assertEquals(styles.get("$"), { left: true, spaced: false, precision: 2 });
  assertEquals(parseHledgerPrint("[]"), []);
});

Deno.test("hledger balance JSON", () => {
  const json = JSON.stringify([
    [
      ["assets:bank:checking", "assets:bank:checking", 0, [usd(318190)]],
      ["liabilities:visa", "liabilities:visa", 0, [usd(-5770)]],
      ["assets:cash", "assets:cash", 0, []],
    ],
    [usd(312420)],
  ]);
  const rows = parseHledgerBalance(json);
  assertEquals(rows.map((r) => [r.account, r.amounts.map((a) => a.quantity)]), [
    ["assets:bank:checking", [3181.9]],
    ["liabilities:visa", [-57.7]],
    ["assets:cash", []],
  ]);
  assertEquals(sortBalances(rows).map((r) => r.account), ["assets:bank:checking", "liabilities:visa"]);
  assertEquals(parseHledgerBalance("{}"), []);
});

const LEDGER_CSV = `"2026/09/29","","Grocery Store","Expenses:Food:Groceries","$","30.10","*",""
"2026/09/29","","Grocery Store","Assets:Checking","$","-30.10","*",""
"2026/10/26","1042","Grocery Store","Expenses:Food:Groceries","$","45.20","!","weekly shop"
"2026/10/26","1042","Grocery Store","Expenses:Household","$","12.50","!",""
"2026/10/26","1042","Grocery Store","Liabilities:Visa","$","-57.70","!",""
"2026/10/26","1042","Grocery Store","Expenses:Food:Groceries","$","5.00","!",""
"2026/10/26","1042","Grocery Store","Liabilities:Visa","$","-5.00","!",""
"2026/10/27","","Broker","Assets:Broker","VTI","2","*",""
"2026/10/27","","Broker","Assets:Checking","$","-1,000.00","*",""
"2026/10/27","","Broker","(Budget:Invest)","$","1000","*",""
`;

Deno.test("ledger csv: grouped into balanced transactions", () => {
  const txns = parseLedgerCsv(LEDGER_CSV);
  assertEquals(txns.map((t) => [t.date, t.payee, t.postings.length, t.status]), [
    ["2026-09-29", "Grocery Store", 2, "*"],
    ["2026-10-26", "Grocery Store", 3, "!"],
    ["2026-10-26", "Grocery Store", 2, "!"], // same payee and day, but the first one balanced
    ["2026-10-27", "Broker", 3, "*"],
  ]);
  assertEquals(txns[1].note, "weekly shop");
  assertEquals(txns[3].postings[2].account, "Budget:Invest");
  assertEquals(txns[3].postings[1].amounts, [{ commodity: "$", quantity: -1000 }]);
  const balances = balancesOf(txns);
  assertEquals(balances.find((b) => b.account === "Liabilities:Visa")?.amounts, [{ commodity: "$", quantity: -62.7 }]);
  assertEquals(balances.find((b) => b.account === "Assets:Broker")?.amounts, [{ commodity: "VTI", quantity: 2 }]);
  assertEquals(parseLedgerCsv('"2026-10-01","","X","A:B","EUR","1","",""\n')[0].date, "2026-10-01");
});

Deno.test("csv quoting", () => {
  assertEquals(parseCsv('a,"b ""c""","d,e"\r\n"multi\nline",x\n'), [["a", 'b "c"', "d,e"], ["multi\nline", "x"]]);
  assertEquals(parseCsv(""), []);
});

Deno.test("bean-query balances and postings", () => {
  const balances = parseBeanBalances(
    'account,balance\nAssets:Checking,3181.90 USD\nAssets:Broker,"10 VTI, 12.00 USD"\nExpenses:Food,75.30 USD\nEquity:Opening,\n',
  );
  assertEquals(balances.map((b) => [b.account, b.amounts]), [
    ["Assets:Checking", [{ commodity: "USD", quantity: 3181.9 }]],
    ["Assets:Broker", [{ commodity: "VTI", quantity: 10 }, { commodity: "USD", quantity: 12 }]],
    ["Expenses:Food", [{ commodity: "USD", quantity: 75.3 }]],
    ["Equity:Opening", []],
  ]);
  const postings = parseBeanPostings(
    `date,flag,payee,narration,account,amount
2026-10-26,*,Grocery Store,weekly shop,Expenses:Food:Groceries,45.20 USD
2026-10-26,*,Grocery Store,weekly shop,Liabilities:Visa,-45.20 USD
2026-10-27,!,,Coffee,Expenses:Food:Coffee,3.50 USD
2026-10-27,!,,Coffee,Assets:Cash,-3.50 USD
`,
  );
  assertEquals(postings.map((t) => [t.payee, t.note, t.status, t.postings.length]), [
    ["Grocery Store", "weekly shop", "*", 2],
    ["Coffee", undefined, "!", 2],
  ]);
  assertEquals(beanPostingsQuery("2026-10-01").includes("WHERE date >= 2026-10-01"), true);
  assertThrows(() => beanPostingsQuery("2026-10-01; DROP"));
});

Deno.test("command lines", () => {
  assertEquals(hledgerPrintArgs("/j", "2026-10-01"), [
    "-f",
    "/j",
    "print",
    "--explicit",
    "-O",
    "json",
    "--begin",
    "2026-10-01",
  ]);
  assertEquals(hledgerBalanceArgs("/j", 1), [
    "-f",
    "/j",
    "balance",
    "--flat",
    "--no-total",
    "--depth",
    "1",
    "-O",
    "json",
  ]);
  assertEquals(ledgerCsvArgs("/j"), ["-f", "/j", "csv", "--date-format", "%Y-%m-%d"]);
  assertEquals(chooseEngine("auto", "/a/main.beancount", true), "beancount");
  assertEquals(chooseEngine("auto", "/a/main.journal", true), "hledger");
  assertEquals(chooseEngine("auto", "/a/main.journal", false), "ledger");
  assertEquals(chooseEngine("Ledger", "/a/x.beancount", true), "ledger");
});

Deno.test("account kinds, in English and French", () => {
  assertEquals(
    [
      "assets:bank",
      "Liabilities:Visa",
      "Equity",
      "Revenus:Salaire",
      "Dépenses:Courses",
      "Budget:X",
      "Income",
      "expenses",
    ]
      .map(kindOf),
    ["assets", "liabilities", "equity", "income", "expenses", "other", "income", "expenses"],
  );
  assertEquals(atDepth("Expenses:Food:Groceries", 2), "Expenses:Food");
  assertEquals(atDepth("Expenses", 2), "Expenses");
});

Deno.test("totals by kind, in the usual order", () => {
  const totals = totalsByKind(balancesOf(parseLedgerCsv(LEDGER_CSV)));
  assertEquals(totals.map((t) => t.top), ["Assets", "Liabilities", "Expenses", "Budget"]);
  assertEquals(totals[0].amounts, [{ commodity: "VTI", quantity: 2 }, { commodity: "$", quantity: -1030.1 }]);
});

Deno.test("this month's expenses by category", () => {
  const txns = parseHledgerPrint(HLEDGER_PRINT);
  assertEquals(mainCommodity(txns), "$");
  const cats = expensesByCategory(txns, monthStart(NOW), monthStart(NOW, 1), "$", 2);
  assertEquals(cats.map((c) => [c.account, Math.round(c.total * 100)]), [
    ["expenses:food", 7320],
    ["expenses:household", 1250],
  ]);
  assertEquals(cats[0].children.map((c) => c.account), ["expenses:food:groceries", "expenses:food:restaurants"]);
  assertEquals(cats[0].txns.length, 2);
  assertEquals(expensesByCategory(txns, monthStart(NOW, -1), monthStart(NOW), "$", 1).map((c) => c.account), [
    "expenses",
  ]);
  assertEquals(monthStart(new Date(2026, 0, 15), -1), "2025-12-01");
});

Deno.test("what a transaction shows", () => {
  const txns = parseHledgerPrint(HLEDGER_PRINT);
  assertEquals(txnAmount(txns[1]), [{ commodity: "$", quantity: 3200 }]); // income, positive
  assertEquals(txnAmount(txns[2]), [{ commodity: "$", quantity: 57.7 }]);
  assertEquals(flow(txns[2]), "expenses:food:groceries, expenses:household ← liabilities:visa");
  assertEquals(flow(txns[0]), "expenses:food:groceries ← assets:bank:checking");
  assertEquals(
    txnText(txns[2], "hledger"),
    [
      "2026-10-26 ! (1042) Grocery Store  ; weekly shop",
      "    expenses:food:groceries  $45.20",
      "    expenses:household       $12.50",
      "    liabilities:visa         -$57.70",
    ].join("\n"),
  );
  assert(txnText(txns[0], "beancount").startsWith('2026-09-29 * "Grocery Store"'));
});

Deno.test("day titles", () => {
  assertEquals(dayTitle("2026-10-28", NOW), "Today");
  assertEquals(dayTitle("2026-10-27", NOW), "Yesterday");
  assertEquals(dayTitle("2026-10-24", NOW), "Saturday");
  assertEquals(dayTitle("2026-10-02", NOW), "Fri, Oct 2");
  assertEquals(dayTitle("2025-12-31", NOW), "Wed, Dec 31, 2025");
});

Deno.test("form input", () => {
  assertEquals(parseAmountInput("12,50", "EUR"), { commodity: "EUR", quantity: 12.5 });
  assertEquals(parseAmountInput("$7", "EUR"), { commodity: "$", quantity: 7 });
  assertEquals(parseAmountInput("3 USD", "$"), { commodity: "USD", quantity: 3 });
  assertThrows(() => parseAmountInput("twelve", "$"));
  assertThrows(() => parseAmountInput("0", "$"));
  assertEquals(parseDateInput("", NOW), "2026-10-28");
  assertEquals(parseDateInput("yesterday", NOW), "2026-10-27");
  assertEquals(parseDateInput("2026/10/3", NOW), "2026-10-03");
  assertEquals(parseDateInput("10-30", NOW), "2026-10-30");
  assertThrows(() => parseDateInput("2026-02-30", NOW));
  assertThrows(() => parseDateInput("next week", NOW));
});

Deno.test("new entries in each syntax", () => {
  const n = {
    date: "2026-10-28",
    payee: "Le Bistro",
    note: "lunch with Ana",
    amount: "28.5",
    to: "Expenses:Food:Restaurants",
    from: "Assets:Checking",
    cleared: true,
  };
  assertEquals(
    formatTxn(n, "hledger", "$"),
    "2026-10-28 * Le Bistro  ; lunch with Ana\n    Expenses:Food:Restaurants  $28.50\n    Assets:Checking\n",
  );
  assertEquals(
    formatTxn({ ...n, cleared: false, note: "", amount: "1234.5 EUR" }, "ledger", "$"),
    "2026-10-28 Le Bistro\n    Expenses:Food:Restaurants  1234.50 EUR\n    Assets:Checking\n",
  );
  assertEquals(
    formatTxn({ ...n, payee: 'Le "Bistro"' }, "beancount", "EUR"),
    '2026-10-28 * "Le \\"Bistro\\"" "lunch with Ana"\n  Expenses:Food:Restaurants  28.50 EUR\n  Assets:Checking\n',
  );
  assertEquals(formatTxn({ ...n, cleared: false }, "beancount", "EUR").slice(11, 13), "! ");
  assertThrows(() => formatTxn(n, "beancount", "$"), Error, "currency");
  assertThrows(() => formatTxn({ ...n, payee: " " }, "hledger", "$"));
  assertThrows(() => formatTxn({ ...n, to: "Assets:Checking" }, "hledger", "$"));
  assertThrows(() => formatTxn({ ...n, to: "Expenses  Food" }, "hledger", "$"));
  const styles: Styles = new Map([["EUR", { left: false, spaced: true, precision: 2 }]]);
  assert(formatTxn({ ...n, amount: "3" }, "hledger", "EUR", styles).includes("  3.00 EUR\n"));
});

Deno.test("appending keeps one blank line before the entry", () => {
  assertEquals(appendTxn("", "E\n"), "E\n");
  assertEquals(appendTxn("A\n", "E\n"), "A\n\nE\n");
  assertEquals(appendTxn("A", "E\n"), "A\n\nE\n");
  assertEquals(appendTxn("A\n\n\n", "E\n"), "A\n\nE\n");
});

Deno.test("journal names", () => {
  assert(journalRank("main.journal") < journalRank("2025.journal"));
  assertEquals(journalRank("notes.txt"), -1);
  assertEquals(journalRank("prices.beancount"), 100);
});

Deno.test("manifest: the same folders as ALLOWED, three programs", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(manifest.permissions.read, ALLOWED);
  assertEquals(manifest.permissions.write, ALLOWED);
  assertEquals(manifest.permissions.run, ["hledger", "ledger", "bean-query"]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
