// Transactions as rows, and the form that adds one.

import {
  action,
  close,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  open,
  pop,
  toast,
} from "@backslash/api";
import { append, ENGINE_TITLE, HOME, type Journal } from "./engine.ts";
import {
  dayTitle,
  flow,
  formatAmounts,
  formatTxn,
  isoDay,
  kindOf,
  parseDateInput,
  type Styles,
  tildify,
  type Txn,
  txnAmount,
  txnText,
} from "./lib.ts";

export function txnItem(
  t: Txn,
  j: Journal,
  styles: Styles,
  o: { now: Date; accounts: string[]; commodity: string },
): Item {
  const amount = txnAmount(t);
  const income = t.postings.some((p) => kindOf(p.account) === "income") &&
    !t.postings.some((p) => kindOf(p.account) === "expenses");
  const text = txnText(t, j.engine, styles);
  const to = t.postings.find((p) => p.amounts.some((a) => a.quantity > 0))?.account ?? "";
  const from = t.postings.find((p) => p.amounts.some((a) => a.quantity < 0))?.account ?? "";
  const similar = { accounts: o.accounts, commodity: o.commodity, payee: t.payee, note: t.note };
  return {
    id: `${t.date}:${t.payee}:${text.length}:${formatAmounts(amount)}`,
    title: t.payee || "(no payee)",
    subtitle: t.note ?? flow(t),
    icon: t.status === "*"
      ? { source: Icons.check, tint: "green" }
      : t.status === "!"
      ? { source: Icons.hourglass, tint: "orange" }
      : { source: Icons.dot, tint: "gray" },
    section: dayTitle(t.date, o.now),
    keywords: [...t.postings.map((p) => p.account), ...(t.code ? [t.code] : [])],
    accessories: [
      ...(t.code ? [{ tag: t.code }] : []),
      { text: formatAmounts(amount, styles), color: income ? "green" as const : undefined },
    ],
    detail: {
      markdown: "```\n" + text + "\n```",
      metadata: [
        meta.text("Date", t.date, { icon: Icons.calendar }),
        meta.text("Status", t.status === "*" ? "Cleared" : t.status === "!" ? "Pending" : "Uncleared", {
          icon: t.status === "*" ? Icons.check : Icons.hourglass,
          color: t.status === "*" ? "green" : t.status === "!" ? "orange" : undefined,
        }),
        ...(t.note ? [meta.text("Note", t.note, { icon: Icons.comment })] : []),
        meta.separator(),
        ...t.postings.map((p) => meta.text(p.account, p.amounts.length ? formatAmounts(p.amounts, styles) : "—")),
      ],
    },
    actions: [
      copy(text, "Copy Entry", { shortcut: "<Ctrl><Shift>c" }),
      action(
        "Add Similar",
        () => addForm(j, styles, { ...similar, ...(income ? { to: from, from: to } : { to, from }) }),
        {
          icon: Icons.plus,
          shortcut: "<Ctrl>d",
        },
      ),
      copy(t.payee, "Copy Payee", { section: "Copy" }),
      copy(formatAmounts(amount, styles), "Copy Amount", { section: "Copy" }),
      open(j.file, "Open Journal", { icon: Icons.file, shortcut: "<Ctrl>o", section: "Journal" }),
    ],
  };
}

export interface AddOptions {
  accounts: string[];
  commodity: string;
  payee?: string;
  to?: string;
  from?: string;
  note?: string;
  /** Opened as its own command: close the launcher when done. */
  standalone?: boolean;
}

/** Accounts for the two dropdowns: categories (expenses, income) and where the money comes from. */
export function accountChoices(accounts: string[]) {
  const sorted = [...new Set(accounts)].sort();
  const categories = sorted.filter((a) => ["expenses", "income"].includes(kindOf(a)));
  const sources = sorted.filter((a) => ["assets", "liabilities", "equity"].includes(kindOf(a)));
  return { categories, sources };
}

export function addForm(j: Journal, styles: Styles, o: AddOptions): FormSpec {
  const { categories, sources } = accountChoices(o.accounts);
  const NEW = "";
  const dropdown = (list: string[], value?: string) =>
    [
      ...list.map((a) => ({ value: a, title: a })),
      { value: NEW, title: "Other (type it below)" },
    ].sort((a, b) => (a.value === value ? -1 : b.value === value ? 1 : 0));
  return form({
    title: `New Transaction · ${tildify(j.file, HOME)}`,
    submitTitle: "Add Transaction",
    fields: [
      field.text("date", "Date", { value: isoDay(new Date()), placeholder: "2026-10-31, today, yesterday" }),
      field.text("payee", "Payee", { required: true, value: o.payee ?? "", placeholder: "Grocery store" }),
      field.text("amount", "Amount", { required: true, placeholder: `12.50 or 12.50 ${o.commodity}` }),
      field.dropdown("to", "Category", dropdown(categories, o.to), {
        value: o.to && categories.includes(o.to) ? o.to : categories[0] ?? NEW,
      }),
      field.dropdown("from", "Paid from", dropdown(sources, o.from), {
        value: o.from && sources.includes(o.from) ? o.from : sources[0] ?? NEW,
      }),
      field.text("toOther", "Other category", { placeholder: "Expenses:Food:Restaurants (when Other is picked)" }),
      field.text("fromOther", "Other account", { placeholder: "Assets:Cash (when Other is picked)" }),
      field.text("note", "Note", { value: o.note ?? "" }),
      field.checkbox("cleared", "Cleared", { value: true }),
    ],
    async submit(values) {
      const now = new Date();
      // "Other" is the empty choice: the account typed below is used instead.
      const to = String(values.to || values.toOther || "").trim();
      const from = String(values.from || values.fromOther || "").trim();
      // Income goes into the account: the money lands there, the income account balances it.
      const isIncome = kindOf(to) === "income";
      const entry = formatTxn(
        {
          date: parseDateInput(String(values.date ?? ""), now),
          payee: String(values.payee ?? ""),
          note: String(values.note ?? ""),
          amount: String(values.amount ?? ""),
          to: isIncome ? from : to,
          from: isIncome ? to : from,
          cleared: values.cleared !== false,
        },
        j.engine,
        o.commodity,
        styles,
      );
      await append(j, entry);
      await toast(`Added to ${tildify(j.file, HOME)}`, { style: "success", message: entry.split("\n")[0] });
      return o.standalone ? close("Transaction added") : pop();
    },
  });
}

export const engineLine = (j: Journal) => `${ENGINE_TITLE[j.engine]} · ${tildify(j.file, HOME)}`;
