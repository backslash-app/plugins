import { assertEquals, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import {
  AuthError,
  balanceSentence,
  dayTitle,
  directionOf,
  equalShares,
  errorText,
  expenseBody,
  friendBalance,
  fromExpense,
  groupBalance,
  keyOf,
  money,
  paidSentence,
  parseAmount,
  parseDate,
  readExpense,
  reminderText,
  setupItem,
  shareLabel,
  sortFriends,
  sortGroups,
  splitwiseError,
  type SwExpense,
  type SwFriend,
  type SwGroup,
  totals,
} from "./lib.ts";

const ME = 100;

Deno.test("key and errors", () => {
  assertThrows(() => keyOf({}), AuthError, "API key");
  assertEquals(keyOf({ apiKey: " Bearer abcDEF123 " }), "abcDEF123");
  assertInstanceOf(splitwiseError(401, { error: "Invalid API request: you are not logged in" }), AuthError);
  assertEquals(errorText({ errors: { base: ["An unknown error occurred"] } }), "An unknown error occurred");
  assertEquals(errorText({ errors: { cost: ["must be positive"] } }), "cost must be positive");
  assertEquals(errorText({ errors: ["Bad"] }), "Bad");
  assertEquals(errorText({ errors: {} }), "");
  assertEquals(splitwiseError(400, { errors: { base: ["Nope"] } }).message, "Splitwise answered 400: Nope");
  assertStringIncludes(setupItem(new AuthError("x")).detail!.markdown!, "Register your application");
});

Deno.test("money and amounts", () => {
  assertEquals(money(12.5, "EUR"), "€12.50");
  assertEquals(money(-3, "USD"), "−US$3.00");
  assertEquals(money(5, "GBP", { sign: true }), "+£5.00");
  assertEquals(money(5, "ZZ1"), "5.00 ZZ1");
  assertEquals(parseAmount("12,50"), 12.5);
  assertEquals(parseAmount("€12.50"), 12.5);
  assertEquals(parseAmount("1 234,56"), 1234.56);
  assertEquals(parseAmount("1,234.56"), 1234.56);
  assertEquals(parseAmount("1.234,56"), 1234.56);
  assertEquals(parseAmount("1,234"), 1234);
  assertEquals(parseAmount("0,500"), 0.5);
  assertEquals(parseAmount("42"), 42);
  assertEquals(parseAmount("4.5"), 4.5);
  assertEquals(parseAmount("0"), undefined);
  assertEquals(parseAmount("abc"), undefined);
});

Deno.test("dates", () => {
  const now = new Date(2026, 9, 30, 15, 0);
  assertEquals(parseDate("", now), "2026-10-30");
  assertEquals(parseDate("yesterday", now), "2026-10-29");
  assertEquals(parseDate("hier", now), "2026-10-29");
  assertEquals(parseDate("2026-10-03", now), "2026-10-03");
  assertEquals(parseDate("3/10", now), "2026-10-03");
  assertEquals(parseDate("31.12.25", now), "2025-12-31");
  assertEquals(parseDate("31/02/2026", now), undefined);
  assertEquals(parseDate("soon", now), undefined);
  assertEquals(dayTitle(new Date(2026, 9, 30, 9).toISOString(), now), "Today");
  assertEquals(dayTitle(new Date(2026, 9, 29, 9).toISOString(), now), "Yesterday");
  assertEquals(dayTitle(new Date(2026, 9, 27, 9).toISOString(), now), "Tuesday 27 October");
  assertEquals(dayTitle(new Date(2026, 2, 12, 9).toISOString(), now), "12 March");
  assertEquals(dayTitle(new Date(2025, 2, 12, 9).toISOString(), now), "12 March 2025");
});

// GET /get_friends
const friends: SwFriend[] = [
  {
    id: 1,
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.org",
    picture: { medium: "https://s3.amazonaws.com/splitwise/uploads/user/avatar/1/medium_ada.jpg" },
    balance: [{ currency_code: "EUR", amount: "12.5" }],
    groups: [
      { group_id: 0, balance: [{ currency_code: "EUR", amount: "2.5" }] },
      { group_id: 7, balance: [{ currency_code: "EUR", amount: "10.0" }] },
      { group_id: 8, balance: [] },
    ],
    updated_at: "2026-10-28T19:02:11Z",
  },
  {
    id: 2,
    first_name: "Bob",
    last_name: null,
    picture: { medium: "https://s3.amazonaws.com/splitwise/uploads/user/default_avatars/avatar-blue1-100px.png" },
    balance: [{ currency_code: "EUR", amount: "-30.25" }],
    groups: [{ group_id: 7, balance: [{ currency_code: "EUR", amount: "-30.25" }] }],
  },
  { id: 3, first_name: "Carol", last_name: "Shaw", balance: [{ currency_code: "EUR", amount: "0.0" }], groups: [] },
  {
    id: 4,
    first_name: "Dan",
    last_name: "",
    balance: [{ currency_code: "EUR", amount: "4.00" }, { currency_code: "USD", amount: "-2.004" }],
  },
  { id: 5, first_name: "Eve", balance: [{ currency_code: "EUR", amount: "40" }] },
];

Deno.test("friend balances", () => {
  const names = new Map([[7, "Ski trip"]]);
  const list = friends.map((f) => friendBalance(f, names));
  const ada = list[0];
  assertEquals(ada.name, "Ada Lovelace");
  assertEquals(ada.direction, "owed");
  assertEquals(ada.groups.map((g) => g.name), ["Non-group expenses", "Ski trip"]);
  assertEquals(balanceSentence(ada.total), "owes you €12.50");
  assertEquals(list[1].name, "Bob");
  assertEquals(balanceSentence(list[1].total), "you owe €30.25");
  assertEquals(list[2].direction, "settled");
  assertEquals(balanceSentence(list[2].total), "settled up");
  assertEquals(list[3].direction, "mixed");
  assertEquals(balanceSentence(list[3].total), "owes you €4.00 · you owe US$2.00");
  assertEquals(sortFriends(list).map((f) => f.name), ["Eve", "Ada Lovelace", "Dan", "Bob", "Carol Shaw"]);
  assertEquals(totals(list), {
    owed: [{ currency: "EUR", amount: 56.5 }],
    owe: [{ currency: "EUR", amount: -30.25 }, { currency: "USD", amount: -2 }],
  });
  assertEquals(
    reminderText(ada),
    "Hi Ada! Splitwise says you owe me €12.50. You can settle up on Splitwise whenever it suits you. Thanks!",
  );
  assertEquals(reminderText(list[1]), "");
  assertEquals(directionOf([]), "settled");
});

// GET /get_groups
const groups: SwGroup[] = [
  {
    id: 0,
    name: "Non-group expenses",
    members: [],
    simplified_debts: [],
  },
  {
    id: 7,
    name: "Ski trip",
    group_type: "trip",
    updated_at: "2026-10-28T19:02:11Z",
    simplify_by_default: true,
    members: [
      { id: ME, first_name: "Steven", balance: [{ currency_code: "EUR", amount: "-20.25" }] },
      { id: 1, first_name: "Ada", last_name: "Lovelace", balance: [{ currency_code: "EUR", amount: "-10.0" }] },
      { id: 2, first_name: "Bob", balance: [{ currency_code: "EUR", amount: "30.25" }] },
    ],
    original_debts: [],
    simplified_debts: [
      { from: ME, to: 2, amount: "20.25", currency_code: "EUR" },
      { from: 1, to: 2, amount: "10.0", currency_code: "EUR" },
    ],
  },
  {
    id: 8,
    name: "Flat",
    group_type: "apartment",
    updated_at: "2026-09-01T10:00:00Z",
    members: [
      { id: ME, first_name: "Steven", balance: [] },
      { id: 1, first_name: "Ada", last_name: "Lovelace", balance: [] },
    ],
    simplified_debts: [],
  },
];

Deno.test("group balances", () => {
  const list = groups.map((g) => groupBalance(g, ME));
  const ski = list[1];
  assertEquals(ski.mine, [{ currency: "EUR", amount: -20.25 }]);
  assertEquals(ski.direction, "owe");
  assertEquals(ski.yourDebts.map((d) => d.text), ["You owe Bob €20.25"]);
  assertEquals(ski.debts, ["You owe Bob €20.25", "Ada Lovelace owes Bob €10.00"]);
  assertEquals(ski.type, "trip");
  assertEquals(list[2].direction, "settled");
  assertEquals(sortGroups(list).map((g) => g.name), ["Ski trip", "Flat"]);
  const owed = groupBalance({
    ...groups[1],
    simplified_debts: [{ from: 2, to: ME, amount: "5", currency_code: "EUR" }],
  }, ME);
  assertEquals(owed.yourDebts.map((d) => d.text), ["Bob owes you €5.00"]);
});

// GET /get_expenses
const dinner: SwExpense = {
  id: 9001,
  group_id: 7,
  friendship_id: null,
  description: "Dinner at Chez Paul",
  details: "With dessert",
  payment: false,
  cost: "60.0",
  currency_code: "EUR",
  date: "2026-10-28T19:00:00Z",
  created_at: "2026-10-28T21:12:00Z",
  deleted_at: null,
  created_by: { id: ME, first_name: "Steven" },
  category: { id: 13, name: "Dining out" },
  users: [
    {
      user: { id: ME, first_name: "Steven" },
      user_id: ME,
      paid_share: "60.0",
      owed_share: "20.0",
      net_balance: "40.0",
    },
    {
      user: { id: 1, first_name: "Ada", last_name: "Lovelace" },
      user_id: 1,
      paid_share: "0.0",
      owed_share: "20.0",
      net_balance: "-20.0",
    },
    { user: { id: 2, first_name: "Bob" }, user_id: 2, paid_share: "0.0", owed_share: "20.0", net_balance: "-20.0" },
  ],
};

Deno.test("expenses", () => {
  const e = fromExpense(dinner, ME)!;
  assertEquals(e.paidBy, ["You"]);
  assertEquals(e.net, 40);
  assertEquals(e.category, "Dining out");
  assertEquals(shareLabel(e), { text: "you lent €40.00", color: "green" });
  assertEquals(paidSentence(e), "You paid €60.00");
  const borrowed = fromExpense({
    ...dinner,
    category: { id: 18, name: "General" },
    users: [
      { user_id: ME, paid_share: "0", owed_share: "30", net_balance: "-30" },
      { user: { id: 1, first_name: "Ada" }, user_id: 1, paid_share: "60", owed_share: "30", net_balance: "30" },
    ],
  }, ME)!;
  assertEquals(borrowed.category, undefined);
  assertEquals(shareLabel(borrowed), { text: "you borrowed €30.00", color: "red" });
  assertEquals(paidSentence(borrowed), "Ada paid €60.00");
  const other = fromExpense({
    ...dinner,
    users: [{ user: { id: 1, first_name: "Ada" }, user_id: 1, paid_share: "60", owed_share: "60", net_balance: "0" }],
  }, ME)!;
  assertEquals(shareLabel(other).text, "not involved");
  const payment = fromExpense({
    ...dinner,
    payment: true,
    description: "Payment",
    cost: "20.0",
    users: [
      { user: { id: 1, first_name: "Ada" }, user_id: 1, paid_share: "20.0", owed_share: "0.0", net_balance: "20.0" },
      { user_id: ME, paid_share: "0.0", owed_share: "20.0", net_balance: "-20.0" },
    ],
  }, ME)!;
  assertEquals(paidSentence(payment), "Ada paid you €20.00");
  assertEquals(shareLabel(payment), { text: "you received €20.00", color: "red" });
  assertEquals(fromExpense({ ...dinner, deleted_at: "2026-10-29T10:00:00Z" }, ME), undefined);
});

Deno.test("equal split", () => {
  assertEquals(equalShares(10, 3), [3.34, 3.33, 3.33]);
  assertEquals(equalShares(25, 2), [12.5, 12.5]);
  assertEquals(equalShares(0.01, 2), [0.01, 0]);
  assertEquals(
    expenseBody(
      { cost: 25, currency: "EUR", description: "Taxi", date: "2026-10-30", with: { kind: "group", id: 7 } },
      ME,
    ),
    {
      cost: "25.00",
      currency_code: "EUR",
      description: "Taxi",
      date: "2026-10-30T12:00:00Z",
      group_id: 7,
      split_equally: true,
    },
  );
  assertEquals(
    expenseBody({
      cost: 25.01,
      currency: "USD",
      description: "Pizza",
      date: "2026-10-30",
      notes: "Friday",
      with: { kind: "friend", id: 1 },
    }, ME),
    {
      cost: "25.01",
      currency_code: "USD",
      description: "Pizza",
      date: "2026-10-30T12:00:00Z",
      details: "Friday",
      group_id: 0,
      users__0__user_id: ME,
      users__0__paid_share: "25.01",
      users__0__owed_share: "12.51",
      users__1__user_id: 1,
      users__1__paid_share: "0.00",
      users__1__owed_share: "12.50",
    },
  );
});

Deno.test("reading the form", () => {
  const now = new Date(2026, 9, 30);
  assertEquals(
    readExpense({ cost: "12,50", description: " Lunch ", currency: "eur", with: "f:1", date: "", notes: "" }, now),
    {
      cost: 12.5,
      currency: "EUR",
      description: "Lunch",
      date: "2026-10-30",
      notes: undefined,
      with: { kind: "friend", id: 1 },
    },
  );
  assertEquals(
    readExpense({ cost: "", description: "x", currency: "EUR", with: "f:1" }, now),
    "Type an amount, like 12.50",
  );
  assertEquals(readExpense({ cost: "3", description: "", currency: "EUR", with: "f:1" }, now), "Type what it was for");
  assertEquals(
    readExpense({ cost: "3", description: "x", currency: "EUR", with: "" }, now),
    "Pick whom you shared it with",
  );
  assertEquals(
    readExpense({ cost: "3", description: "x", currency: "EUR", with: "g:7", date: "31/02" }, now),
    "Type the date as 2026-10-29 or 29/10",
  );
});
