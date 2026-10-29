import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  actualExpense,
  dayTitle,
  fireflyExpense,
  fromActualMonth,
  fromActualTransaction,
  fromFireflyAccount,
  fromFireflyBudgets,
  fromFireflyGroup,
  fromFireflySummary,
  HOSTS,
  isAllowedHost,
  kindLook,
  money,
  monthProgress,
  monthRange,
  normalizeUrl,
  parseAmount,
  parseDate,
  readExpense,
  sortBudgets,
  totals,
  usage,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("firefly.local"));
  assert(isAllowedHost("192.168.1.20"));
  assert(isAllowedHost("100.100.1.2"));
  assert(isAllowedHost("demo.firefly-iii.org"));
  assert(!isAllowedHost("firefly.example.com"));
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("firefly.local/"), "http://firefly.local");
  assertEquals(normalizeUrl("http://192.168.1.20:8080/api/v1"), "http://192.168.1.20:8080");
  assertEquals(normalizeUrl("https://nas.lan/firefly/login"), "https://nas.lan/firefly");
  assertEquals(normalizeUrl(""), "");
});

Deno.test("amounts typed by hand", () => {
  assertEquals(parseAmount("12,50"), 12.5);
  assertEquals(parseAmount("12.50 €"), 12.5);
  assertEquals(parseAmount("-€1 234,56"), 1234.56);
  assertEquals(parseAmount("1,234.56"), 1234.56);
  assertEquals(parseAmount("1.234,56"), 1234.56);
  assertEquals(parseAmount("1,234"), 1234);
  assertEquals(parseAmount("1.500"), 1500);
  assertEquals(parseAmount("3"), 3);
  assertEquals(parseAmount("0"), undefined);
  assertEquals(parseAmount("abc"), undefined);
  assertEquals(parseAmount("9.999"), 9999);
  assertEquals(parseAmount("4.5"), 4.5);
});

Deno.test("money", () => {
  assertEquals(money(1234.5, "EUR"), "€1,234.50");
  assertEquals(money(-12, "USD"), "−US$12.00");
  assertEquals(money(5, "GBP", { sign: true }), "+£5.00");
  assertEquals(money(5, "XYZ1"), "5.00 XYZ1");
});

Deno.test("dates", () => {
  const now = new Date(2026, 9, 29, 15, 0);
  assertEquals(monthRange(now), { start: "2026-10-01", end: "2026-10-31", month: "2026-10", title: "October 2026" });
  assertEquals(monthRange(new Date(2026, 0, 15), -1).start, "2025-12-01");
  assertEquals(monthRange(new Date(2024, 1, 10)).end, "2024-02-29");
  assertEquals(parseDate("", now), "2026-10-29");
  assertEquals(parseDate("yesterday", now), "2026-10-28");
  assertEquals(parseDate("hier", now), "2026-10-28");
  assertEquals(parseDate("2026-10-03", now), "2026-10-03");
  assertEquals(parseDate("3/10", now), "2026-10-03");
  assertEquals(parseDate("31/12/25", now), "2025-12-31");
  assertEquals(parseDate("31/02/2026", now), undefined);
  assertEquals(parseDate("next week", now), undefined);
  assertEquals(dayTitle("2026-10-29", now), "Today");
  assertEquals(dayTitle("2026-10-28", now), "Yesterday");
  assertEquals(dayTitle("2026-10-26", now), "Monday 26 October");
  assertEquals(dayTitle("2025-10-26", now), "Sunday 26 October 2025");
  const p = monthProgress(new Date(2026, 9, 16, 12));
  assert(p > 0.49 && p < 0.51);
});

Deno.test("budget usage and order", () => {
  assertEquals(usage({ budgeted: 100, spent: 50 }, 0.5).color, "green");
  assertEquals(usage({ budgeted: 100, spent: 80 }, 0.5).color, "orange");
  assertEquals(usage({ budgeted: 100, spent: 120 }).color, "red");
  assertEquals(usage({ budgeted: 0, spent: 10 }).color, "orange");
  assertEquals(usage({ budgeted: 0, spent: 0 }).color, "gray");
  const line = (name: string, budgeted: number, spent: number) => ({
    provider: "firefly" as const,
    id: name,
    name,
    budgeted,
    spent,
    currency: "EUR",
  });
  assertEquals(
    sortBudgets([line("a", 100, 10), line("none", 0, 500), line("b", 100, 90), line("c", 50, 60)]).map((l) => l.name),
    [
      "c",
      "b",
      "a",
      "none",
    ],
  );
});

Deno.test("firefly accounts and net worth", () => {
  const a = fromFireflyAccount({
    id: "3",
    attributes: {
      name: "Savings",
      type: "asset",
      account_role: "savingAsset",
      current_balance: "1500.25",
      currency_code: "EUR",
      iban: "FR76 3000",
      include_net_worth: true,
    },
  });
  assertEquals([a.group, a.balance, a.iban, a.netWorth], ["Savings", 1500.25, "FR76 3000", true]);
  const debt = fromFireflyAccount({
    id: "9",
    attributes: { name: "Car loan", type: "liabilities", current_balance: "-3000" },
  });
  assertEquals(debt.group, "Liabilities");
  const hidden = { ...a, id: "4", netWorth: false, balance: 999 };
  assertEquals(totals([a, debt, hidden]), [{ currency: "EUR", total: -1499.75 }]);
});

Deno.test("firefly summary", () => {
  const s = fromFireflySummary({
    "spent-in-EUR": { key: "spent-in-EUR", monetary_value: -812.4, currency_code: "EUR" },
    "earned-in-EUR": { key: "earned-in-EUR", monetary_value: "2500", currency_code: "EUR" },
    "left-to-spend-in-EUR": { monetary_value: 187.6, currency_code: "EUR" },
    "net-worth-in-EUR": { monetary_value: 12000, currency_code: "EUR" },
    "bills-paid-in-EUR": { monetary_value: -100 },
  });
  assertEquals(s, [{ provider: "firefly", currency: "EUR", spent: 812.4, earned: 2500, left: 187.6, netWorth: 12000 }]);
});

Deno.test("firefly budgets with their limits", () => {
  const lines = fromFireflyBudgets(
    [
      { id: "1", attributes: { name: "Groceries", spent: [{ sum: "-245.10", currency_code: "EUR" }] } },
      { id: "2", attributes: { name: "Fun", spent: [] } },
      { id: "3", attributes: { name: "Old", active: false } },
    ],
    [{ id: "10", attributes: { budget_id: 1, amount: "400", currency_code: "EUR" } }],
  );
  assertEquals(lines.map((l) => [l.name, l.budgeted, l.spent]), [["Groceries", 400, 245.1], ["Fun", 0, 0]]);
});

Deno.test("firefly transactions", () => {
  const [t] = fromFireflyGroup({
    id: "77",
    attributes: {
      group_title: null,
      transactions: [{
        transaction_journal_id: "78",
        type: "withdrawal",
        date: "2026-10-28T12:00:00+01:00",
        amount: "42.50",
        currency_code: "EUR",
        description: "Supermarket",
        source_name: "Checking",
        destination_name: "Lidl",
        category_name: "Groceries",
        budget_name: null,
        tags: [],
      }],
    },
  });
  assertEquals(t.amount, -42.5);
  assertEquals(t.date, "2026-10-28");
  assertEquals([t.account, t.counterparty, t.category, t.budget, t.tags], [
    "Checking",
    "Lidl",
    "Groceries",
    undefined,
    undefined,
  ]);
  assertEquals(kindLook(t), { color: "red", label: "Expense" });
  const [d] = fromFireflyGroup({
    id: "80",
    attributes: {
      transactions: [{
        type: "deposit",
        date: "2026-10-01",
        amount: "2500",
        description: "Salary",
        source_name: "ACME",
        destination_name: "Checking",
      }],
    },
  });
  assertEquals([d.amount, d.account, d.counterparty, kindLook(d).label], [2500, "Checking", "ACME", "Income"]);
});

Deno.test("expenses: the form and the request bodies", () => {
  const now = new Date(2026, 9, 29);
  assertEquals(readExpense({ amount: "", description: "x", account: "1" }, now), "Type an amount, e.g. 12.50");
  assertEquals(readExpense({ amount: "3", description: " ", account: "1" }, now), "Describe the expense");
  assertEquals(
    readExpense({ amount: "3", description: "x", account: "1", date: "soon" }, now),
    "The date should look like 2026-10-29 or 29/10",
  );
  const e = readExpense({
    amount: "12,5",
    description: "Lunch",
    account: "4",
    category: "Food",
    budget: "",
    date: "",
    notes: "",
  }, now);
  assertEquals(e, {
    amount: 12.5,
    description: "Lunch",
    date: "2026-10-29",
    account: "4",
    category: "Food",
    budget: undefined,
    payee: undefined,
    notes: undefined,
  });
  if (typeof e === "string") throw new Error(e);
  assertEquals(fireflyExpense(e), {
    error_if_duplicate_hash: false,
    apply_rules: true,
    fire_webhooks: true,
    transactions: [{
      type: "withdrawal",
      date: "2026-10-29",
      amount: "12.50",
      description: "Lunch",
      source_id: "4",
      destination_name: "Lunch",
      category_name: "Food",
    }],
  });
  assertEquals(actualExpense({ ...e, category: "cat-1", payee: "Café" }), {
    transaction: {
      account: "4",
      date: "2026-10-29",
      amount: -1250,
      payee_name: "Café",
      category: "cat-1",
      notes: "Lunch",
      cleared: false,
    },
  });
});

Deno.test("actual months and transactions (cents)", () => {
  const m = fromActualMonth({
    month: "2026-10",
    totalIncome: 250000,
    totalSpent: -81240,
    toBudget: 1500,
    categoryGroups: [
      {
        id: "g1",
        name: "Usual Expenses",
        categories: [
          { id: "c1", name: "Food", budgeted: 40000, spent: -24510, balance: 15490 },
          { id: "c2", name: "Hidden", hidden: true, budgeted: 0, spent: 0 },
        ],
      },
      { id: "g2", name: "Income", is_income: true, categories: [{ id: "c9", name: "Salary", is_income: true }] },
    ],
  }, "EUR");
  assertEquals(m.lines, [{
    provider: "actual",
    id: "c1",
    name: "Food",
    group: "Usual Expenses",
    budgeted: 400,
    spent: 245.1,
    currency: "EUR",
  }]);
  assertEquals(m.summary, { provider: "actual", currency: "EUR", spent: 812.4, earned: 2500, left: 15 });
  const t = fromActualTransaction(
    { id: "t1", account: "a1", date: "2026-10-27", amount: -1999, payee: "p1", category: "c1", notes: null },
    {
      accounts: new Map([["a1", "Checking"]]),
      payees: new Map([["p1", "Carrefour"]]),
      categories: new Map([["c1", "Food"]]),
    },
    "EUR",
  );
  assertEquals([t.amount, t.kind, t.description, t.account, t.category], [
    -19.99,
    "withdrawal",
    "Carrefour",
    "Checking",
    "Food",
  ]);
  const tr = fromActualTransaction(
    { id: "t2", account: "a1", date: "2026-10-27", amount: -5000, transfer_id: "t3" },
    { accounts: new Map(), payees: new Map(), categories: new Map() },
    "EUR",
  );
  assertEquals(tr.kind, "transfer");
});
