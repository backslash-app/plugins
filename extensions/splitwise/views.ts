// Rows for friends, groups and expenses; the new expense form.

import {
  type Action,
  action,
  close,
  copy,
  field,
  form,
  Icons,
  type Item,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { type Choices, choices, createExpense, deleteExpense, lastChoice } from "./api.ts";
import {
  balanceSentence,
  COMMON_CURRENCIES,
  dashboardUrl,
  dayTitle,
  type Expense,
  expenseUrl,
  type FriendBalance,
  friendUrl,
  type GroupBalance,
  groupUrl,
  isoDay,
  type Money,
  money,
  moneyList,
  paidSentence,
  parseAmount,
  readExpense,
  reminderText,
  shareLabel,
} from "./lib.ts";

export const reloadAction = (): Action =>
  action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });

const tint = (total: Money[]) =>
  !total.length
    ? "gray" as const
    : total.every((m) => m.amount > 0)
    ? "green" as const
    : total.every((m) => m.amount < 0)
    ? "red" as const
    : "orange" as const;

const pills = (total: Money[]) =>
  total.map((m) => ({
    tag: money(m.amount, m.currency, { sign: true }),
    color: m.amount > 0 ? "green" as const : "red" as const,
  }));

// ---------------------------------------------------------------------------
// Totals

export function totalItem(t: { owed: Money[]; owe: Money[] }): Item {
  const net = [...t.owed, ...t.owe];
  const byCurrency = new Map<string, number>();
  for (const m of net) byCurrency.set(m.currency, (byCurrency.get(m.currency) ?? 0) + m.amount);
  return {
    id: "total",
    title: t.owed.length || t.owe.length ? "Your balance" : "All settled up",
    subtitle: [
      t.owed.length ? `you are owed ${moneyList(t.owed)}` : "",
      t.owe.length ? `you owe ${moneyList(t.owe)}` : "",
    ].filter(Boolean).join(" · ") || "Nobody owes anybody",
    icon: { source: Icons.coin, tint: tint(net) },
    section: "Total",
    accessories: [...byCurrency].map(([currency, amount]) => ({
      tag: money(amount, currency, { sign: true }),
      color: amount >= 0 ? "green" as const : "red" as const,
    })),
    detail: {
      stats: [
        ...t.owed.map((m) => ({
          label: `Owed to you (${m.currency})`,
          value: money(m.amount, m.currency),
          color: "green" as const,
        })),
        ...t.owe.map((m) => ({
          label: `You owe (${m.currency})`,
          value: money(-m.amount, m.currency),
          color: "red" as const,
        })),
      ],
      markdown: "Settle up in Splitwise: payments are recorded there.",
    },
    actions: [open(dashboardUrl, "Open Splitwise"), reloadAction()],
  };
}

// ---------------------------------------------------------------------------
// Friends

const SECTIONS = { owed: "Owes You", mixed: "Owes You and You Owe", owe: "You Owe", settled: "Settled Up" };

export function friendItem(key: string, f: FriendBalance): Item {
  const reminder = reminderText(f);
  return {
    id: `friend:${f.id}`,
    title: f.name,
    subtitle: balanceSentence(f.total),
    icon: { source: Icons.person, tint: tint(f.total) },
    section: SECTIONS[f.direction],
    keywords: [f.email ?? "", ...f.groups.map((g) => g.name)],
    accessories: [
      ...(f.groups.length > 1 ? [{ text: `${f.groups.length} groups`, icon: Icons.layers }] : []),
      ...pills(f.total),
    ],
    detail: {
      stats: f.total.map((m) => ({
        label: m.amount > 0 ? "Owes you" : "You owe",
        value: money(Math.abs(m.amount), m.currency),
        color: m.amount > 0 ? "green" as const : "red" as const,
      })),
      markdown: f.direction === "settled" ? `You and ${f.name} are settled up.` : undefined,
      metadata: [
        ...f.groups.map((g) => meta.text(g.name, balanceSentence(g.balance, "owes you"), { icon: Icons.layers })),
        ...(f.groups.length ? [meta.separator()] : []),
        ...(f.email ? [meta.text("Email", f.email, { icon: Icons.mail })] : []),
        meta.person("Friend", f.name),
      ],
    },
    actions: [
      open(friendUrl(f.id), f.direction === "settled" ? "Open in Splitwise" : "Settle Up in Splitwise", {
        icon: Icons.coin,
      }),
      action("Add Expense…", () => expenseForm(key, { with: `f:${f.id}` }), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      ...(reminder ? [copy(reminder, "Copy Reminder", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
      ...(f.total.length ? [copy(moneyList(f.total), "Copy Amount", { section: "Copy" })] : []),
      ...(f.email && reminder
        ? [open(
          `mailto:${f.email}?subject=${encodeURIComponent("Splitwise")}&body=${encodeURIComponent(reminder)}`,
          "Email Reminder",
          { icon: Icons.mail, section: "Copy" },
        )]
        : []),
      reloadAction(),
    ],
  };
}

// ---------------------------------------------------------------------------
// Groups

export function groupItem(key: string, g: GroupBalance): Item {
  return {
    id: `group:${g.id}`,
    title: g.name,
    subtitle: g.yourDebts.length ? g.yourDebts.map((d) => d.text).join(" · ") : balanceSentence(g.mine, "you get back"),
    icon: { source: Icons.layers, tint: tint(g.mine) },
    section: "Groups",
    keywords: [...g.members.map((m) => m.name), g.type ?? ""],
    accessories: [
      { text: String(g.members.length), icon: Icons.person, tooltip: "Members" },
      ...(g.mine.length ? pills(g.mine) : [{ tag: "settled", color: "gray" as const }]),
    ],
    detail: {
      stats: g.mine.map((m) => ({
        label: m.amount > 0 ? "You get back" : "You owe",
        value: money(Math.abs(m.amount), m.currency),
        color: m.amount > 0 ? "green" as const : "red" as const,
      })),
      markdown: g.debts.length
        ? ["### Who owes whom", "", ...g.debts.map((d) => `- ${d}`)].join("\n")
        : "Everyone in the group is settled up.",
      metadata: [
        ...g.members.map((m) =>
          meta.text(
            m.name,
            m.balance.length ? balanceSentence(m.balance, "gets back").replace("you owe", "owes") : "settled",
            {
              icon: Icons.person,
            },
          )
        ),
        ...(g.type ? [meta.separator(), meta.text("Type", g.type.replace(/^\w/, (c) => c.toUpperCase()))] : []),
      ],
    },
    actions: [
      open(groupUrl(g.id), g.mine.length ? "Settle Up in Splitwise" : "Open in Splitwise", { icon: Icons.coin }),
      action("Add Expense…", () => expenseForm(key, { with: `g:${g.id}` }), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      ...(g.debts.length
        ? [copy(`${g.name}:\n${g.debts.map((d) => `- ${d}`).join("\n")}`, "Copy Who Owes Whom", {
          shortcut: "<Ctrl><Shift>c",
          section: "Copy",
        })]
        : []),
      reloadAction(),
    ],
  };
}

// ---------------------------------------------------------------------------
// Expenses

export function expenseItem(key: string, e: Expense, groups: Map<number, string>): Item {
  const share = shareLabel(e);
  const group = e.groupId ? groups.get(e.groupId) : undefined;
  return {
    id: `expense:${e.id}`,
    title: e.description,
    subtitle: [paidSentence(e), group].filter(Boolean).join(" · "),
    icon: {
      source: e.payment ? Icons.arrowRight : Icons.coin,
      tint: share.color ?? "gray",
    },
    section: dayTitle(e.date),
    keywords: [...e.shares.map((s) => s.name), e.category ?? "", group ?? "", e.payment ? "payment" : ""],
    accessories: [
      ...(e.category ? [{ text: e.category, color: "gray" as const }] : []),
      { tag: share.text, color: share.color },
    ],
    detail: {
      stats: [
        { label: e.payment ? "Payment" : "Total", value: money(e.cost, e.currency) },
        ...(e.involved && e.net !== 0
          ? [{
            label: e.net > 0 ? "You lent" : "You borrowed",
            value: money(Math.abs(e.net), e.currency),
            color: share.color,
          }]
          : []),
      ],
      markdown: [
        "| | Paid | Share |",
        "|---|---:|---:|",
        ...e.shares.map((s) => `| ${s.name} | ${money(s.paid, e.currency)} | ${money(s.owed, e.currency)} |`),
        ...(e.notes ? ["", e.notes] : []),
      ].join("\n"),
      metadata: [
        meta.text("Date", new Date(e.date).toLocaleDateString("en-GB", { dateStyle: "long" }), {
          icon: Icons.calendar,
        }),
        ...(group ? [meta.text("Group", group, { icon: Icons.layers })] : []),
        ...(e.category ? [meta.text("Category", e.category, { icon: Icons.tag })] : []),
        ...(e.createdBy ? [meta.text("Added by", e.createdBy, { icon: Icons.person })] : []),
      ],
    },
    actions: [
      open(expenseUrl(e), "Open in Splitwise"),
      copy(`${e.description}: ${money(e.cost, e.currency)}`, "Copy Summary", {
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(e.cost.toFixed(2), "Copy Amount", { section: "Copy" }),
      action("Delete Expense", async () => {
        await deleteExpense(key, e.id);
        await toast("Expense deleted", {
          style: "success",
          message: "Splitwise can restore it from its activity page",
        });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete “${e.description}” (${money(e.cost, e.currency)}) for everyone in it?`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
      reloadAction(),
    ],
  };
}

// ---------------------------------------------------------------------------
// New expense form

export async function expenseForm(
  key: string,
  initial: { with?: string; amount?: string; description?: string } = {},
  loaded?: Choices,
) {
  const c = loaded ?? await choices(key);
  const last = await lastChoice();
  const options = [
    ...c.groups.map((g) => ({ value: `g:${g.id}`, title: `${g.name} (group)` })),
    ...c.friends.map((f) => ({ value: `f:${f.id}`, title: f.name })),
  ];
  if (!options.length) throw new Error("Add a friend or a group in Splitwise first");
  const pick = [initial.with, last.with].find((w) => w && options.some((o) => o.value === w)) ?? options[0].value;
  const currency = last.currency ?? c.currency;
  const currencies = [...new Set([c.currency, currency, ...COMMON_CURRENCIES])];
  const amount = parseAmount(initial.amount);
  return form({
    title: "New Splitwise Expense: you paid, split equally",
    submitTitle: "Add Expense",
    fields: [
      field.text("description", "Description", {
        required: true,
        placeholder: "Dinner, groceries, train tickets…",
        ...(initial.description ? { value: initial.description } : {}),
      }),
      field.text("cost", "Amount", {
        required: true,
        placeholder: "42.00",
        ...(amount ? { value: amount.toFixed(2) } : {}),
      }),
      field.dropdown("currency", "Currency", currencies, { value: currency }),
      field.dropdown("with", "Split with", options, { value: pick }),
      field.text("date", "Date", { value: isoDay(new Date()), placeholder: "2026-10-29, 29/10, yesterday" }),
      field.textArea("notes", "Notes"),
    ],
    async submit(values) {
      const e = readExpense(values);
      if (typeof e === "string") throw new Error(e);
      await createExpense(key, c.me, e);
      const name = options.find((o) => o.value === values.with)?.title.replace(/ \(group\)$/, "");
      return close(`Added ${money(e.cost, e.currency)} · ${e.description}${name ? ` with ${name}` : ""}`);
    },
  });
}
