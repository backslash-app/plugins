import { type Action, action, copy, Icons, type Item, list, meta, refresh, submenu } from "@backslash/api";
import {
  choices,
  currentGame,
  type Game,
  nextQuestion,
  NoQuestions,
  resetStats,
  saveChoices,
  saveStats,
  setGame,
  stats,
} from "../api.ts";
import {
  CATEGORIES,
  DIFFICULTIES,
  difficultyOf,
  KINDS,
  percent,
  praise,
  type Question,
  score,
  scoreLine,
  type Settings,
  settingsText,
  shareText,
  shortCategory,
  type Stats,
} from "../lib.ts";

const DIFFICULTY_COLOR = { easy: "green", medium: "orange", hard: "red", any: "gray" } as const;

function settingsActions(s: Settings, current: Stats): Action[] {
  return [
    submenu("Category", [
      action(`${s.category === 0 ? "✓ " : ""}Any Category`, async () => {
        await saveChoices({ category: 0, kind: s.kind });
        return refresh();
      }),
      ...CATEGORIES.map((c) =>
        action(`${s.category === c.id ? "✓ " : ""}${shortCategory(c.name)}`, async () => {
          await saveChoices({ category: c.id, kind: s.kind });
          return refresh();
        })
      ),
    ], { icon: Icons.filter, shortcut: "<Ctrl>l", section: "Settings" }),
    submenu(
      "Question Type",
      KINDS.map((k) =>
        action(`${s.kind === k.value ? "✓ " : ""}${k.title}`, async () => {
          await saveChoices({ category: s.category, kind: k.value });
          return refresh();
        })
      ),
      { icon: Icons.question, shortcut: "<Ctrl>t", section: "Settings" },
    ),
    copy(shareText(current), "Copy Score", { icon: Icons.text, section: "Score" }),
    action("Reset Score", async () => {
      await resetStats();
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: "Reset your score and best streak?",
      section: "Score",
    }),
  ];
}

const next = (title = "Next Question") =>
  action(title, async () => {
    await setGame(undefined);
    return refresh();
  }, { icon: Icons.arrowRight, shortcut: "<Ctrl>n" });

function questionMarkdown(q: Question, game: Game): string {
  const lines = [`## ${q.text}`, ""];
  if (game.choice !== undefined) {
    const right = game.choice === q.correct;
    lines.push(
      right ? `✅ **${q.correct}** is right.` : `❌ You said **${game.choice}**. The answer was **${q.correct}**.`,
    );
  } else {
    lines.push(q.kind === "boolean" ? "True or false?" : "Pick the right answer.");
  }
  return lines.join("\n");
}

function questionMetadata(q: Question, s: Stats) {
  return [
    meta.text("Category", shortCategory(q.category)),
    meta.tags("Difficulty", [{ text: q.difficulty, color: DIFFICULTY_COLOR[q.difficulty] }]),
    meta.separator(),
    meta.text("Score", s.answered ? `${s.correct}/${s.answered} (${percent(s)})` : "–"),
    meta.text("Streak", String(s.streak), { icon: Icons.bolt }),
    meta.text("Best streak", String(s.best), { icon: Icons.starFilled }),
  ];
}

function answerItems(game: Game, s: Stats, settings: Settings): Item[] {
  const q = game.question;
  const answered = game.choice !== undefined;
  const extra = settingsActions(settings, s);
  const items: Item[] = [];
  if (answered) {
    const right = game.choice === q.correct;
    items.push({
      id: "next",
      title: "Next Question",
      subtitle: right ? praise(s.streak) : `The answer was ${q.correct}`,
      icon: { source: right ? Icons.check : Icons.cross, tint: right ? "green" : "red" },
      section: right ? "Right" : "Wrong",
      accessories: [{ text: scoreLine(s) }],
      detail: { markdown: questionMarkdown(q, game), metadata: questionMetadata(q, s) },
      actions: [next(), copy(`${q.text} — ${q.correct}`, "Copy Question and Answer"), ...extra],
    });
  }
  q.answers.forEach((answer, i) => {
    const isRight = answer === q.correct;
    const picked = answer === game.choice;
    const icon = !answered
      ? {
        source: q.kind === "boolean" ? (answer === "True" ? Icons.check : Icons.cross) : Icons.todo,
        tint: "blue" as const,
      }
      : isRight
      ? { source: Icons.check, tint: "green" as const }
      : picked
      ? { source: Icons.cross, tint: "red" as const }
      : { source: Icons.todo, tint: "gray" as const };
    items.push({
      id: `answer:${q.id}:${i}`,
      title: answer,
      icon,
      section: q.text,
      keywords: [String(i + 1)],
      accessories: answered
        ? [
          ...(isRight ? [{ tag: "Answer", color: "green" as const }] : []),
          ...(picked && !isRight ? [{ tag: "Your answer", color: "red" as const }] : []),
        ]
        : [{ text: String(i + 1) }],
      detail: { markdown: questionMarkdown(q, game), metadata: questionMetadata(q, s) },
      actions: answered ? [next(), ...extra] : [
        action("Answer", async () => {
          const now = await currentGame(settings) ?? game;
          if (now.choice !== undefined || now.question.id !== q.id) return refresh();
          await saveStats(score(await stats(), q, answer));
          await setGame({ question: q, choice: answer });
          return refresh();
        }, { icon: Icons.check }),
        action("Skip Question", async () => {
          await setGame(undefined);
          return refresh();
        }, { icon: Icons.next, shortcut: "<Ctrl>n" }),
        ...extra,
      ],
    });
  });
  return items;
}

export default list({
  placeholder: "Pick an answer, or type its number",
  filter: { options: DIFFICULTIES.map((d) => ({ value: d.value, title: d.title })), default: "any" },
  empty: { title: "No question", icon: Icons.question },
  status: (items) => {
    const first = items.find((i) => i.id === "next" || i.id?.startsWith("answer:"));
    if (!first) return "";
    const score = first.detail?.metadata?.find((m) => m.label === "Score")?.value ?? "–";
    const streak = first.detail?.metadata?.find((m) => m.label === "Streak")?.value ?? "0";
    return `Score ${score} · streak ${streak}`;
  },
  items: async (ctx) => {
    const c = await choices();
    const settings: Settings = { category: c.category, kind: c.kind, difficulty: difficultyOf(ctx.filter) };
    const s = await stats();
    let game = await currentGame(settings);
    if (!game) {
      try {
        game = { question: await nextQuestion(settings, ctx.signal) };
        await setGame(game);
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        const none = e instanceof NoQuestions;
        return [{
          id: "error",
          title: none ? "No more questions here" : (e as Error).message,
          subtitle: none ? `Open Trivia DB has no question for ${settingsText(settings)}` : "Try again in a moment",
          icon: { source: Icons.alert, tint: none ? "orange" : "red" },
          detail: {
            markdown: none
              ? "Some categories have few questions at a given difficulty or type. Pick **Any Difficulty**, another category or **Any Type**."
              : "Open Trivia DB allows one request every 5 seconds and is sometimes slow. Your score is kept.",
          },
          actions: [
            action("Try Again", () => refresh(), { icon: Icons.refresh }),
            ...(settings.category || settings.kind !== "any"
              ? [action("Any Category and Type", async () => {
                await saveChoices({ category: 0, kind: "any" });
                return refresh();
              }, { icon: Icons.filter })]
              : []),
            ...settingsActions(settings, s),
          ],
        }];
      }
    }
    return answerItems(game, s, settings);
  },
  actions: [
    action("Next Question", async () => {
      await setGame(undefined);
      return refresh();
    }, { icon: Icons.arrowRight }),
  ],
});
