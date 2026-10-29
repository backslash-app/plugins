// Rows for accounts, budgets and transactions; the expense form.

import {
  type Action,
  action,
  close,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import {
  addExpense,
  type Backend,
  type Choices,
  choices,
  deleteTransaction,
  type each,
  lastAccount,
  savedChoices,
  SetupError,
  setupItem,
  transactions,
  webUrl,
} from "./api.ts";
import {
  type Account,
  type BudgetLine,
  dayTitle,
  isoDate,
  kindLook,
  money,
  monthProgress,
  type MonthSummary,
  parseAmount,
  PROVIDER_NAMES,
  readExpense,
  type Transaction,
  usage,
} from "./lib.ts";

/** Setup rows when nothing loaded because of the settings; toasts when only some servers failed. */
export async function report<T>(
  r: Awaited<ReturnType<typeof each<T>>>,
): Promise<Item[] | undefined> {
  if (!r.errors.length) return undefined;
  if (!r.ok.length) {
    const setup = r.errors.find((e) => e.error instanceof SetupError);
    if (setup) return [setupItem(setup.error as SetupError)];
    throw r.errors[0].error;
  }
  await toast(`${r.errors.map((e) => PROVIDER_NAMES[e.backend.provider]).join(", ")} didn't answer`, {
    style: "failure",
    message: r.errors.map((e) => e.error.message).join(" · "),
  });
  return undefined;
}

const PROVIDER_TAG = (b: Backend, many: boolean) =>
  many ? [{ tag: b.provider === "firefly" ? "Firefly" : "Actual", color: "gray" as const }] : [];

// ---------------------------------------------------------------------------
// Accounts

export function accountItem(b: Backend, a: Account, many: boolean): Item {
  const url = webUrl(b, { account: a.id });
  return {
    id: `${a.provider}:${a.id}`,
    title: a.name,
    subtitle: a.iban,
    icon: {
      source: a.group === "Savings"
        ? Icons.archive
        : a.group === "Cash"
        ? Icons.coin
        : a.group === "Liabilities"
        ? Icons.chartDown
        : Icons.home,
      tint: a.balance < 0 ? "red" : "green",
    },
    section: many ? `${PROVIDER_NAMES[a.provider]} · ${a.group}` : a.group,
    keywords: [a.group, a.iban ?? "", a.currency],
    accessories: [...PROVIDER_TAG(b, many), {
      tag: money(a.balance, a.currency),
      color: a.balance < 0 ? "red" : "green",
    }],
    actions: [
      action("Show Transactions", () => accountTransactions(b, a), { icon: Icons.history }),
      ...(url ? [open(url, `Open in ${PROVIDER_NAMES[a.provider]}`, { shortcut: "<Ctrl>o" })] : []),
      action("Add Expense", () => expenseFormFor(b, undefined, { account: a.id }), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
      }),
      copy(money(a.balance, a.currency), "Copy Balance", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(a.iban ? [copy(a.iban.replace(/\s+/g, ""), "Copy IBAN", { section: "Copy" })] : []),
    ],
  };
}

function accountTransactions(b: Backend, a: Account) {
  return list({
    title: a.name,
    placeholder: `Filter ${a.name}'s transactions…`,
    empty: { title: "No transaction in the last 60 days", icon: Icons.history },
    async items({ signal }) {
      const txs = await transactions(b, { account: a.id, days: 60, signal });
      return sortTransactions(txs).map((t) => transactionItem(b, t, false));
    },
  });
}

// ---------------------------------------------------------------------------
// Budgets

export function summaryItem(s: MonthSummary, title: string, many: boolean): Item {
  const net = s.earned - s.spent;
  return {
    id: `summary:${s.provider}:${s.currency}`,
    title: `${title}: ${money(s.spent, s.currency)} spent`,
    subtitle: `${money(s.earned, s.currency)} earned`,
    icon: { source: net >= 0 ? Icons.chartUp : Icons.chartDown, tint: net >= 0 ? "green" : "red" },
    section: many ? PROVIDER_NAMES[s.provider] : "Month",
    accessories: s.left !== undefined
      ? [{
        tag: `${money(s.left, s.currency)} ${s.provider === "actual" ? "to budget" : "left"}`,
        color: s.left < 0 ? "red" : "green",
      }]
      : [],
    detail: {
      stats: [
        { label: "Spent", value: money(s.spent, s.currency), color: "red" },
        { label: "Earned", value: money(s.earned, s.currency), color: "green" },
        { label: "Net", value: money(net, s.currency, { sign: true }), color: net >= 0 ? "green" : "red" },
      ],
      metadata: [
        ...(s.left !== undefined
          ? [meta.text(s.provider === "actual" ? "To budget" : "Left to spend", money(s.left, s.currency))]
          : []),
        ...(s.netWorth !== undefined
          ? [meta.text("Net worth", money(s.netWorth, s.currency), { icon: Icons.coin })]
          : []),
        meta.text("Source", PROVIDER_NAMES[s.provider]),
      ],
    },
  };
}

export function budgetItem(b: Backend, line: BudgetLine, current: boolean, many: boolean): Item {
  const pace = current ? monthProgress() : 1;
  const u = usage(line, pace);
  const left = line.budgeted - line.spent;
  const url = webUrl(b);
  return {
    id: `${line.provider}:${line.id}`,
    title: line.name,
    subtitle: line.budgeted > 0
      ? left >= 0 ? `${money(left, line.currency)} left` : `${money(-left, line.currency)} over`
      : line.spent > 0
      ? "No budget set"
      : undefined,
    icon: { source: u.ratio > 1 ? Icons.alert : Icons.chartDown, tint: u.color },
    section: many ? `${PROVIDER_NAMES[line.provider]}${line.group ? ` · ${line.group}` : ""}` : line.group ?? "Budgets",
    keywords: [line.group ?? ""],
    accessories: [
      ...PROVIDER_TAG(b, many),
      {
        tag: line.budgeted > 0
          ? `${money(line.spent, line.currency)} / ${money(line.budgeted, line.currency)}`
          : money(line.spent, line.currency),
        color: u.color === "gray" ? undefined : u.color,
      },
      ...(line.budgeted > 0 ? [{ text: `${Math.round(u.ratio * 100)}%` }] : []),
    ],
    detail: {
      stats: [
        { label: "Spent", value: money(line.spent, line.currency) },
        { label: "Budgeted", value: line.budgeted > 0 ? money(line.budgeted, line.currency) : "—" },
        {
          label: left >= 0 ? "Left" : "Over",
          value: money(Math.abs(left), line.currency),
          color: left >= 0 ? "green" : "red",
        },
      ],
      metadata: [
        ...(line.budgeted > 0 ? [meta.progress("Used", Math.min(1, u.ratio), `${Math.round(u.ratio * 100)} %`)] : []),
        ...(current && line.budgeted > 0
          ? [meta.text("Month elapsed", `${Math.round(pace * 100)} %`, { icon: Icons.calendar })]
          : []),
        ...(line.group ? [meta.text("Group", line.group)] : []),
        meta.text("Source", PROVIDER_NAMES[line.provider]),
      ],
    },
    actions: [
      ...(url ? [open(url, `Open in ${PROVIDER_NAMES[line.provider]}`)] : []),
      action(
        "Add Expense",
        () =>
          expenseFormFor(b, undefined, {
            category: line.provider === "actual" ? line.id : undefined,
            budget: line.provider === "firefly" ? line.id : undefined,
          }),
        {
          icon: Icons.plus,
          shortcut: "<Ctrl>n",
        },
      ),
      copy(
        `${line.name}: ${money(line.spent, line.currency)} of ${money(line.budgeted, line.currency)}`,
        "Copy Summary",
        {
          section: "Copy",
        },
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Transactions

export const sortTransactions = (list: Transaction[]) =>
  [...list].sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.amount) - Math.abs(a.amount));

export function transactionItem(b: Backend, t: Transaction, many: boolean): Item {
  const look = kindLook(t);
  const url = t.provider === "firefly" ? webUrl(b, { transaction: t.groupId }) : webUrl(b, { account: undefined });
  const route = t.kind === "transfer"
    ? `${t.account} → ${t.counterparty}`
    : t.amount < 0
    ? `${t.account} → ${t.counterparty || "?"}`
    : `${t.counterparty || "?"} → ${t.account}`;
  return {
    id: `${t.provider}:${t.id}`,
    title: t.description,
    subtitle: [t.category, t.kind === "transfer" ? route : t.counterparty !== t.description ? t.counterparty : ""]
      .filter(Boolean).join(" · "),
    icon: {
      source: t.kind === "transfer" ? Icons.arrowRight : t.amount < 0 ? Icons.arrowUp : Icons.arrowDown,
      tint: look.color,
    },
    section: dayTitle(t.date),
    keywords: [t.account, t.counterparty, t.category ?? "", t.budget ?? "", ...(t.tags ?? []), look.label],
    accessories: [
      ...PROVIDER_TAG(b, many),
      ...(t.category
        ? []
        : t.kind === "withdrawal"
        ? [{ icon: { source: Icons.question, tint: "orange" as const }, tooltip: "No category" }]
        : []),
      { tag: money(t.amount, t.currency, { sign: t.kind === "deposit" }), color: look.color },
    ],
    detail: {
      stats: [
        { label: look.label, value: money(Math.abs(t.amount), t.currency), color: look.color },
        { label: "Date", value: t.date },
      ],
      markdown: t.notes && t.notes !== t.description ? t.notes : undefined,
      metadata: [
        meta.text("From → to", route, { icon: Icons.arrowRight }),
        ...(t.category ? [meta.text("Category", t.category, { icon: Icons.tag })] : []),
        ...(t.budget ? [meta.text("Budget", t.budget, { icon: Icons.chartDown })] : []),
        ...(t.tags?.length ? [meta.tags("Tags", t.tags)] : []),
        meta.separator(),
        meta.text("Source", PROVIDER_NAMES[t.provider]),
      ],
    },
    actions: [
      ...(url ? [open(url, `Open in ${PROVIDER_NAMES[t.provider]}`)] : []),
      copy(money(Math.abs(t.amount), t.currency), "Copy Amount", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(t.description, "Copy Description", { section: "Copy" }),
      action("Delete Transaction", async () => {
        await deleteTransaction(b, t);
        await toast("Transaction deleted", { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete “${t.description}” (${money(t.amount, t.currency)})? This can't be undone`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Expense form

export async function expenseFormFor(
  b: Backend,
  loaded?: Choices,
  initial: { amount?: string; description?: string; account?: string; category?: string; budget?: string } = {},
) {
  const saved = loaded ? undefined : await savedChoices(b);
  // The saved lists show the form at once; they are refreshed for next time.
  if (saved) choices(b).catch(() => {});
  const c = loaded ?? saved ?? await choices(b);
  if (!c.accounts.length) throw new Error(`No account to spend from in ${PROVIDER_NAMES[b.provider]}`);
  const account = initial.account ?? await lastAccount(b) ?? c.accounts[0].value;
  const firefly = b.provider === "firefly";
  const amount = parseAmount(initial.amount);
  return form({
    title: `New Expense in ${PROVIDER_NAMES[b.provider]}`,
    submitTitle: "Add Expense",
    fields: [
      field.text("amount", "Amount", {
        required: true,
        placeholder: "12.50",
        ...(amount ? { value: amount.toFixed(2) } : {}),
      }),
      field.text("description", "Description", {
        required: true,
        placeholder: "Groceries, lunch, train ticket…",
        ...(initial.description ? { value: initial.description } : {}),
      }),
      field.dropdown("category", "Category", [{ value: "", title: "No category" }, ...c.categories], {
        value: initial.category ?? "",
      }),
      field.dropdown("account", "Account", c.accounts, {
        value: c.accounts.some((a) => a.value === account) ? account : c.accounts[0].value,
      }),
      ...(firefly && c.budgets.length
        ? [
          field.dropdown("budget", "Budget", [{ value: "", title: "No budget" }, ...c.budgets], {
            value: initial.budget ?? "",
          }),
        ]
        : []),
      field.text("payee", firefly ? "Paid to" : "Payee", { placeholder: "Optional: the shop or person" }),
      field.text("date", "Date", { value: isoDate(new Date()), placeholder: "2026-10-29, 29/10, yesterday" }),
      field.textArea("notes", "Notes"),
    ],
    async submit(values) {
      const e = readExpense(values);
      if (typeof e === "string") throw new Error(e);
      await addExpense(b, e);
      const currency = b.provider === "actual" ? b.currency : "EUR";
      return close(
        `Added ${b.provider === "actual" ? money(e.amount, currency) : e.amount.toFixed(2)} · ${e.description}`,
      );
    },
  });
}

export const reloadAction = (): Action =>
  action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });
