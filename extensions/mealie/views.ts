// Rows for recipes, meals, shopping items and stock, and their actions.

import {
  type Action,
  action,
  clipboard,
  copy,
  detail,
  Icons,
  type Item,
  meta,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  addRecipeToList,
  consume,
  grocyAddProductToList,
  openProduct,
  planRecipe,
  recipe,
  type Server,
  shoppingLists,
} from "./api.ts";
import {
  addDays,
  amountText,
  capitalize,
  daysUntil,
  ingredientsText,
  isoDate,
  type MealPlanEntry,
  plural,
  type Recipe,
  recipeImage,
  recipeMarkdown,
  type RecipeSummary,
  recipeTimes,
  recipeUrl,
  relativeDays,
  servings,
  STATE_TITLES,
  type StockItem,
} from "./lib.ts";

// ---------------------------------------------------------------------------
// Recipes

function recipeMetadata(r: RecipeSummary) {
  return [
    ...recipeTimes(r).map((t) => meta.text(t.label, t.value, { icon: Icons.clock })),
    ...(servings(r) ? [meta.text("Makes", servings(r)!, { icon: Icons.coffee })] : []),
    ...(r.rating ? [meta.text("Rating", "★".repeat(Math.round(r.rating)) + "☆".repeat(5 - Math.round(r.rating)))] : []),
    ...(r.recipeCategory?.length ? [meta.tags("Categories", r.recipeCategory.map((c) => c.name))] : []),
    ...(r.tags?.length ? [meta.tags("Tags", r.tags.map((t) => t.name))] : []),
  ];
}

/** "Add Ingredients to …" for each Mealie shopping list, loaded when opened. */
function addToListMenu(s: Server, r: RecipeSummary): Action {
  return submenu("Add Ingredients to List", async () => {
    const lists = await shoppingLists(s);
    if (!lists.length) return [action("No shopping list in Mealie", () => {})];
    return lists.map((l) =>
      action(l.name, async () => {
        await addRecipeToList(s, l, r.id);
        await toast(`Ingredients of ${r.name} added to ${l.name}`, { style: "success" });
      }, { icon: Icons.squareCheck })
    );
  }, { icon: Icons.plus, shortcut: "<Ctrl>l" });
}

function planMenu(s: Server, r: RecipeSummary): Action {
  const now = new Date();
  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(now, n));
  return submenu(
    "Plan for Dinner",
    days.map((d, n) =>
      action(
        n === 0 ? "Tonight" : n === 1 ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric" }),
        async () => {
          await planRecipe(s, r.id, isoDate(d), "dinner");
          await toast(
            `${r.name} planned ${n === 0 ? "tonight" : `for ${d.toLocaleDateString("en-GB", { weekday: "long" })}`}`,
            {
              style: "success",
            },
          );
        },
        { icon: Icons.calendar },
      )
    ),
    { icon: Icons.calendar, shortcut: "<Ctrl>p" },
  );
}

export function recipeView(s: Server, r: RecipeSummary, group?: string) {
  return detail({
    title: r.name,
    async markdown({ signal }) {
      return recipeMarkdown(await recipe(s, r, signal));
    },
    metadata: recipeMetadata(r),
    actions: [
      open(recipeUrl(s.base, r.slug, group), "Open in Mealie"),
      addToListMenu(s, r),
      planMenu(s, r),
      action("Copy Ingredients", async () => {
        const full = await recipe(s, r);
        await clipboard.write(ingredientsText(full));
        await toast("Ingredients copied", { style: "success" });
      }, { icon: Icons.copy, shortcut: "<Ctrl><Shift>c" }),
    ],
  });
}

export function recipeItem(s: Server, r: RecipeSummary, full: Recipe | undefined, group?: string): Item {
  const url = recipeUrl(s.base, r.slug, group);
  const time = recipeTimes(r)[0];
  return {
    id: r.slug,
    title: r.name,
    subtitle: r.description?.replace(/\s+/g, " ").trim() || undefined,
    icon: recipeImage(s.base, r, "tiny") ?? { source: Icons.book, tint: "orange" },
    keywords: [...(r.tags ?? []).map((t) => t.name), ...(r.recipeCategory ?? []).map((c) => c.name)],
    accessories: [
      ...(full?.recipeIngredient?.length
        ? [{ text: plural(full.recipeIngredient.length, "ingredient"), tooltip: "Ingredients" }]
        : []),
      ...(time
        ? [{ text: time.value, icon: { source: Icons.clock, tint: "gray" as const }, tooltip: `${time.label} time` }]
        : []),
      ...(r.rating ? [{ text: `★ ${r.rating}`, tooltip: "Rating" }] : []),
    ],
    detail: {
      image: recipeImage(s.base, r),
      markdown: full ? recipeMarkdown(full) : `### ${r.name}${r.description ? `\n\n${r.description}` : ""}`,
      metadata: recipeMetadata(r),
    },
    actions: [
      action("Show Recipe", () => recipeView(s, r, group), { icon: Icons.book }),
      open(url, "Open in Mealie", { shortcut: "<Ctrl>o" }),
      addToListMenu(s, r),
      planMenu(s, r),
      ...(full
        ? [copy(ingredientsText(full), "Copy Ingredients", { shortcut: "<Ctrl><Shift>c", section: "Copy" })]
        : []),
      copy(url, "Copy Link", { section: "Copy" }),
      ...(full?.orgURL ? [open(full.orgURL, "Open Original Recipe", { icon: Icons.external })] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Meal plan

const MEAL_ICONS: Record<string, string> = {
  breakfast: Icons.sun,
  lunch: Icons.coffee,
  dinner: Icons.moon,
  side: Icons.leaf,
  snack: Icons.smile,
  dessert: Icons.heart,
};

export function mealItem(s: Server, m: MealPlanEntry, section: string, group?: string): Item {
  const r = m.recipe ?? undefined;
  const type = String(m.entryType ?? "meal").toLowerCase();
  return {
    id: String(m.id),
    title: r?.name ?? m.title?.trim() ?? "Untitled meal",
    subtitle: capitalize(type),
    icon: r ? recipeImage(s.base, r, "tiny") ?? { source: MEAL_ICONS[type] ?? Icons.book, tint: "orange" } : {
      source: MEAL_ICONS[type] ?? Icons.note,
      tint: "gray",
    },
    section,
    keywords: [type, ...(r?.tags ?? []).map((t) => t.name)],
    accessories: [{
      tag: capitalize(type),
      color: type === "dinner" ? "purple" : type === "lunch" ? "orange" : "gray",
    }],
    detail: r
      ? {
        image: recipeImage(s.base, r),
        markdown: `### ${r.name}\n\n${r.description ?? ""}${m.text ? `\n\n${m.text}` : ""}`,
        metadata: recipeMetadata(r),
      }
      : { markdown: `### ${m.title ?? "Note"}\n\n${m.text ?? ""}` },
    actions: r
      ? [
        action("Show Recipe", () => recipeView(s, r, group), { icon: Icons.book }),
        open(recipeUrl(s.base, r.slug, group), "Open in Mealie", { shortcut: "<Ctrl>o" }),
        addToListMenu(s, r),
      ]
      : [open(`${s.base}/${group ? "household" : "group"}/mealplan/planner/view`, "Open Meal Planner")],
  };
}

// ---------------------------------------------------------------------------
// Grocy stock

const STATE_LOOK: Record<StockItem["state"], { icon: string; tint: "red" | "orange" | "yellow" | "blue" | "green" }> = {
  expired: { icon: Icons.alert, tint: "red" },
  overdue: { icon: Icons.clock, tint: "orange" },
  due: { icon: Icons.hourglass, tint: "yellow" },
  missing: { icon: Icons.minus, tint: "blue" },
  ok: { icon: Icons.box, tint: "green" },
};

export function stockItem(s: Server, p: StockItem, now = new Date()): Item {
  const look = STATE_LOOK[p.state];
  const days = p.bestBefore ? daysUntil(p.bestBefore, now) : undefined;
  const one = Math.min(1, p.amount);
  const actions: Action[] = [];
  if (p.amount > 0) {
    actions.push(
      action(`Consume ${one === 1 ? "1" : one}${p.unit ? ` ${p.unit}` : ""}`, async () => {
        await consume(s, p.productId, one);
        await toast(`Consumed ${one} ${p.name}`, { style: "success" });
        return refresh();
      }, { icon: Icons.check }),
    );
    if (p.opened < p.amount) {
      actions.push(action("Mark 1 as Opened", async () => {
        await openProduct(s, p.productId, 1);
        await toast(`${p.name} opened`, { style: "success" });
        return refresh();
      }, { icon: Icons.box, shortcut: "<Ctrl>o" }));
    }
  }
  actions.push(
    action("Add to Shopping List", async () => {
      await grocyAddProductToList(s, p.productId, p.missing && p.missing > 0 ? p.missing : 1);
      await toast(`${p.name} added to the shopping list`, { style: "success" });
    }, { icon: Icons.plus, shortcut: "<Ctrl>l" }),
    open(`${s.base}/stockentries?productid=${p.productId}`, "Open in Grocy", { shortcut: "<Ctrl><Shift>o" }),
  );
  if (p.amount > 0) {
    actions.push(
      action(p.state === "expired" ? "Throw Away All (Spoiled)" : "Consume All", async () => {
        await consume(s, p.productId, p.amount, p.state === "expired");
        await toast(`${p.name}: none left`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Remove all ${amountText(p)} of ${p.name} from stock?`,
        section: "Stock",
      }),
    );
  }
  return {
    id: p.productId,
    title: p.name,
    subtitle: [amountText(p), p.location].filter(Boolean).join(" · "),
    icon: { source: look.icon, tint: look.tint },
    section: p.state === "ok" ? p.location ?? "In stock" : STATE_TITLES[p.state],
    keywords: [p.location ?? "", STATE_TITLES[p.state]],
    accessories: [
      ...(p.missing ? [{ tag: `${p.missing} missing`, color: "blue" as const }] : []),
      ...(days !== undefined
        ? [{
          text: relativeDays(days),
          color: days < 0 ? "red" as const : days <= 2 ? "orange" as const : undefined,
          tooltip: `Best before ${p.bestBefore}`,
        }]
        : []),
    ],
    detail: {
      stats: [
        { label: "In stock", value: amountText({ ...p, opened: 0 }) },
        ...(p.opened ? [{ label: "Opened", value: String(p.opened) }] : []),
        ...(days !== undefined
          ? [{ label: "Best before", value: relativeDays(days), color: days < 0 ? "red" as const : undefined }]
          : []),
      ],
      metadata: [
        meta.text("State", STATE_TITLES[p.state], { icon: look.icon, color: look.tint }),
        ...(p.bestBefore ? [meta.text("Best before", p.bestBefore, { icon: Icons.calendar })] : []),
        ...(p.location ? [meta.text("Location", p.location, { icon: Icons.home })] : []),
        ...(p.missing ? [meta.text("Below minimum by", String(p.missing))] : []),
      ],
    },
    actions,
  };
}
