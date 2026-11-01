// Plants kept in the extension's storage, the form to add or edit one, and their launcher items.

import {
  type Action,
  action,
  close,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  pop,
  storage,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  actualRhythm,
  dayOf,
  daysBetween,
  dueSummary,
  every,
  feed,
  feedDue,
  formatDay,
  newId,
  nextWatering,
  type Plant,
  plantFromForm,
  plural,
  sanitize,
  section,
  snooze,
  speciesOf,
  undoWater,
  water,
  waterDue,
} from "./lib.ts";
import { HUMIDITY, LIGHT, SPECIES, type Species } from "./species.ts";

type Json = Parameters<typeof storage.set>[1];

export const today = () => dayOf(new Date());

export async function loadPlants(): Promise<Plant[]> {
  return sanitize(await storage.get("plants").catch(() => undefined));
}

async function savePlants(plants: Plant[]): Promise<void> {
  await storage.set("plants", plants as unknown as Json);
  await syncSubtitle(plants);
  changes.dispatchEvent(new Event("change"));
}

/** "2 plants need water" under the command in the root search. */
export async function syncSubtitle(plants?: Plant[]): Promise<void> {
  const all = plants ?? await loadPlants();
  await updateCommandMetadata({ subtitle: dueSummary(all, today()) || null }).catch(() => {});
}

export async function update(id: string, change: (p: Plant) => Plant): Promise<Plant | undefined> {
  const plants = await loadPlants();
  const i = plants.findIndex((p) => p.id === id);
  if (i < 0) return undefined;
  plants[i] = change(plants[i]);
  await savePlants(plants);
  return plants[i];
}

async function upsert(plant: Plant): Promise<void> {
  const plants = await loadPlants();
  const i = plants.findIndex((p) => p.id === plant.id);
  if (i >= 0) plants[i] = plant;
  else plants.push(plant);
  await savePlants(plants);
}

async function remove(id: string): Promise<void> {
  await savePlants((await loadPlants()).filter((p) => p.id !== id));
}

// --- Live reload: the list follows changes and the day changing ---------------

const changes = new EventTarget();

export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, 10 * 60_000);
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

// --- Form ------------------------------------------------------------------------

const speciesOptions = [
  { value: "", title: "Other / not listed" },
  ...[...SPECIES].sort((x, y) => x.name.localeCompare(y.name)).map((s) => ({
    value: s.id,
    title: `${s.name} (${s.latin})`,
  })),
];

export function plantForm(o: { plant?: Plant; species?: Species; standalone?: boolean } = {}): FormSpec {
  const p = o.plant;
  const s = o.species ?? (p ? speciesOf(p) : undefined);
  return form({
    title: p ? `Edit “${p.name}”` : "New Plant",
    submitTitle: p ? "Save Plant" : "Add Plant",
    fields: [
      field.text("name", "Name", {
        required: true,
        placeholder: "Living room monstera",
        value: p?.name ?? s?.name ?? "",
      }),
      field.dropdown("species", "Species", speciesOptions, { value: s?.id ?? "" }),
      field.text("room", "Room", { placeholder: "Optional: Bedroom, Office…", value: p?.room ?? "" }),
      field.text("waterEvery", "Water every (days)", {
        placeholder: "Empty: the species' usual rhythm, else 7",
        value: p ? String(p.waterEvery) : "",
      }),
      field.text("feedEvery", "Fertilize every (weeks)", {
        placeholder: "Empty: the species' usual rhythm; 0 for never",
        value: p?.feedEvery !== undefined ? String(p.feedEvery) : "",
      }),
      field.text("lastWatered", "Last watered", {
        placeholder: "today, yesterday, 3 days ago, 2026-10-28",
        value: p ? "" : "today",
      }),
      field.textArea("notes", "Notes", { placeholder: "Optional: soil, pot, what it likes", value: p?.notes ?? "" }),
    ],
    async submit(values) {
      const plant = plantFromForm(values, today(), p, p?.id ?? newId(), Date.now());
      await upsert(plant);
      const label = waterDue(plant, today()).label.toLowerCase();
      await toast(p ? "Plant saved" : `${plant.name} added: ${label}`, { style: "success" });
      return o.standalone ? close(`${plant.name}: ${label}`) : pop();
    },
  });
}

// --- Items -----------------------------------------------------------------------

function careMarkdown(s: Species): string[] {
  return [
    `### ${s.name} · *${s.latin}*`,
    "",
    s.tip,
    "",
    `- **Light:** ${LIGHT[s.light]}`,
    `- **Humidity:** ${HUMIDITY[s.humidity]}`,
    `- **Water:** about ${every(s.waterDays)} in spring and summer, less in winter`,
    `- **Fertilizer:** ${s.feedWeeks ? `${every(s.feedWeeks * 7)} in the growing season` : "rarely or never"}`,
    `- **Pets:** ${s.toxic ? "⚠️ toxic to cats and dogs (ASPCA)" : "not toxic to cats and dogs (ASPCA)"}`,
  ];
}

export const waterAction = (p: Plant): Action =>
  action("Water Now", async () => {
    await update(p.id, (x) => water(x, today()));
    await toast(`${p.name} watered`, { style: "success", message: `Next ${every(p.waterEvery)}` });
  }, { icon: Icons.droplet });

export function plantItem(p: Plant, day: string): Item {
  const due = waterDue(p, day);
  const fed = feedDue(p, day);
  const s = speciesOf(p);
  const rhythm = actualRhythm(p);
  const metadata: Metadata[] = [
    meta.tags("Water", [{ text: due.label, color: due.color }]),
    meta.text("Every", `${plural(p.waterEvery, "day")}`, { icon: Icons.repeat }),
    meta.text("Last watered", p.lastWatered ? formatDay(p.lastWatered, day) : "Never", { icon: Icons.droplet }),
    meta.text("Next", formatDay(nextWatering(p, day), day), { icon: Icons.calendar }),
    ...(rhythm ? [meta.text("You actually water", every(rhythm))] : []),
    ...(fed
      ? [
        meta.separator(),
        meta.tags("Fertilizer", [{ text: fed.label, color: fed.color }]),
        meta.text("Last fed", p.lastFed ? formatDay(p.lastFed, day) : "Never"),
      ]
      : []),
    ...(p.room ? [meta.separator(), meta.text("Room", p.room, { icon: Icons.home })] : []),
    ...(s
      ? [meta.tags("Pets", [s.toxic ? { text: "Toxic", color: "red" as const } : { text: "Safe", color: "green" }])]
      : []),
  ];
  const markdown = [
    `## ${p.name}`,
    ...(p.notes ? ["", p.notes] : []),
    ...(s ? ["", ...careMarkdown(s)] : []),
    ...(p.history.length
      ? [
        "",
        "### Last waterings",
        "",
        ...p.history.slice(0, 10).map((d, i, all) =>
          `- ${formatDay(d, day)}${all[i + 1] ? ` · ${plural(daysBetween(all[i + 1], d), "day")} later` : ""}`
        ),
      ]
      : []),
  ].join("\n");
  const actions: Action[] = [
    waterAction(p),
    action("Fertilize Now", async () => {
      await update(p.id, (x) => feed(x, today()));
      await toast(`${p.name} fertilized`, { style: "success" });
    }, { icon: Icons.sparkle, shortcut: "<Ctrl>f" }),
    action("Snooze 1 Day", async () => {
      await update(p.id, (x) => snooze(x, today()));
      await toast(`${p.name}: tomorrow`, { style: "success" });
    }, { icon: Icons.clock, shortcut: "<Ctrl>s" }),
    action("Edit Plant", () => plantForm({ plant: p }), { icon: Icons.text, shortcut: "<Ctrl>e" }),
    action("New Plant", () => plantForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    ...(p.history.length
      ? [action("Undo Last Watering", async () => {
        await update(p.id, undoWater);
        await toast(`Removed the watering of ${formatDay(p.history[0], today())}`, { style: "success" });
      }, { icon: Icons.history, section: "More" })]
      : []),
    copy(`${p.name}: ${due.label.toLowerCase()}, ${every(p.waterEvery)}`, "Copy Schedule", { section: "More" }),
    action("Delete Plant", async () => {
      await remove(p.id);
      await toast(`Deleted “${p.name}”`, { style: "success" });
    }, { icon: Icons.trash, destructive: true, confirm: `Delete “${p.name}” and its history?`, section: "Danger" }),
  ];
  return {
    id: p.id,
    title: p.name,
    subtitle: [p.room, s?.name !== p.name ? s?.name : undefined].filter(Boolean).join(" · ") || undefined,
    icon: { source: due.days <= 0 ? Icons.droplet : Icons.leaf, tint: due.days <= 0 ? due.color : "green" },
    section: section(p, day),
    keywords: [p.room ?? "", s?.name ?? "", s?.nameFr ?? "", s?.latin ?? ""].filter(Boolean),
    accessories: [
      ...(fed && fed.days <= 0 ? [{ tag: "Feed", color: "purple" as const }] : []),
      { tag: due.label, color: due.color },
    ],
    detail: { markdown, metadata },
    actions,
  };
}

export function speciesItem(s: Species): Item {
  return {
    id: `species:${s.id}`,
    title: s.name,
    subtitle: s.latin,
    icon: { source: Icons.leaf, tint: s.toxic ? "orange" : "green" },
    keywords: [
      s.nameFr,
      s.latin,
      s.light,
      s.humidity,
      s.toxic ? "toxic" : "pet safe",
      s.toxic ? "toxique" : "sans danger",
    ],
    accessories: [
      { text: every(s.waterDays), icon: Icons.droplet },
      ...(s.toxic ? [{ tag: "Toxic to pets", color: "red" as const }] : [{ tag: "Pet safe", color: "green" as const }]),
    ],
    detail: {
      markdown: careMarkdown(s).join("\n"),
      metadata: [
        meta.text("French", s.nameFr),
        meta.text("Water", every(s.waterDays), { icon: Icons.droplet }),
        meta.text("Light", LIGHT[s.light], { icon: Icons.sun }),
        meta.text("Humidity", HUMIDITY[s.humidity]),
      ],
    },
    actions: [
      action("Add This Plant", () => plantForm({ species: s }), { icon: Icons.plus }),
      copy(`${s.name} (${s.latin}): ${s.tip}`, "Copy Care Tips"),
    ],
  };
}
