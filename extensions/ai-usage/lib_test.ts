import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  anthropicReport,
  budgetOf,
  dailyChart,
  daysInMonth,
  elapsedDays,
  forecast,
  level,
  lineItemModel,
  money,
  monthStart,
  openaiReport,
  openrouterReport,
  shortModel,
  shortMoney,
  shouldNotify,
  sumDaily,
  tokens,
} from "./lib.ts";
import { keysOf } from "./api.ts";

// Thursday 29 October 2026, 12:00 UTC.
const NOW = Date.parse("2026-10-29T12:00:00Z");

Deno.test("month arithmetic in UTC", () => {
  assertEquals(new Date(monthStart(NOW)).toISOString(), "2026-10-01T00:00:00.000Z");
  assertEquals(daysInMonth(NOW), 31);
  assertEquals(daysInMonth(Date.parse("2028-02-10T00:00:00Z")), 29);
  assertAlmostEquals(elapsedDays(NOW), 28.5);
  assertAlmostEquals(forecast(285, NOW), 310);
});

Deno.test("Anthropic cost and usage reports", () => {
  const costs = [
    {
      starting_at: "2026-10-28T00:00:00Z",
      ending_at: "2026-10-29T00:00:00Z",
      results: [
        {
          amount: "1250.5",
          currency: "USD",
          description: "Claude Opus 5.5 Usage - Input Tokens",
          model: "claude-opus-5-5",
        },
        { amount: "50", currency: "USD", description: "Web Search Usage", cost_type: "web_search", model: null },
      ],
    },
    {
      starting_at: "2026-10-29T00:00:00Z",
      ending_at: "2026-10-30T00:00:00Z",
      results: [{ amount: "300", currency: "USD", model: "claude-haiku-5-5", description: "Haiku" }],
    },
  ];
  const usage = [{
    starting_at: "2026-10-28T00:00:00Z",
    ending_at: "2026-10-29T00:00:00Z",
    results: [{
      model: "claude-opus-5-5",
      uncached_input_tokens: 1000,
      cache_read_input_tokens: 3000,
      cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 0 },
      output_tokens: 700,
    }],
  }];
  const r = anthropicReport(costs, usage, NOW);
  // Amounts are cents.
  assertAlmostEquals(r.month, 16.005);
  assertAlmostEquals(r.today, 3);
  assertEquals(r.models.map((m) => m.model), ["claude-opus-5-5", "claude-haiku-5-5", "Web search"]);
  assertEquals(r.models[0].inputTokens, 4500);
  assertEquals(r.models[0].cachedTokens, 3000);
  assertEquals(r.models[0].outputTokens, 700);
});

Deno.test("OpenAI costs by line item and usage by model", () => {
  const day = (iso: string) => Date.parse(iso) / 1000;
  const costs = [{
    start_time: day("2026-10-29T00:00:00Z"),
    end_time: day("2026-10-30T00:00:00Z"),
    results: [
      { amount: { value: 1.5, currency: "usd" }, line_item: "gpt-5, input" },
      { amount: { value: "0.25", currency: "usd" }, line_item: "gpt-5, cached input" },
      { amount: { value: 0.1, currency: "usd" }, line_item: null },
    ],
  }];
  const usage = [{
    start_time: day("2026-10-29T00:00:00Z"),
    end_time: day("2026-10-30T00:00:00Z"),
    results: [{
      model: "gpt-5",
      input_tokens: 2000,
      output_tokens: 300,
      input_cached_tokens: 500,
      num_model_requests: 4,
    }],
  }];
  const r = openaiReport(costs, usage, NOW);
  assertAlmostEquals(r.month, 1.85);
  assertAlmostEquals(r.today, 1.85);
  assertEquals(r.models[0].model, "gpt-5");
  assertAlmostEquals(r.models[0].cost, 1.75);
  assertEquals(r.models[0].requests, 4);
  assertEquals(lineItemModel("o3-mini, output"), "o3-mini");
});

Deno.test("OpenRouter key, credits and activity", () => {
  const r = openrouterReport(
    { data: { usage: 40, usage_daily: 1.2, usage_monthly: 9.5, limit: null } },
    { data: { total_credits: 50, total_usage: 40 } },
    {
      data: [
        { date: "2026-10-28", model: "anthropic/claude-opus-5-5", usage: 6, requests: 10, prompt_tokens: 100 },
        { date: "2026-09-30", model: "openai/gpt-5", usage: 99 },
        { date: "2026-10-29", model: "openai/gpt-5", usage: 3.5, requests: 2 },
      ],
    },
    NOW,
  );
  assertEquals([r.month, r.today, r.balance], [9.5, 1.2, 10]);
  assertEquals(r.models.map((m) => [m.model, m.cost]), [["anthropic/claude-opus-5-5", 6], ["openai/gpt-5", 3.5]]);
  assertEquals(r.note, undefined);
  const plain = openrouterReport({ data: { usage_daily: 0.5, usage_monthly: 2 } }, undefined, undefined, NOW);
  assertEquals([plain.month, plain.balance, plain.models.length], [2, undefined, 0]);
  assert(plain.note);
});

Deno.test("budget levels and notifications", () => {
  const b = budgetOf({ budget: 100, warnAt: 80 });
  assertEquals([level(10, b), level(80, b), level(100, b)], ["ok", "warn", "over"]);
  assertEquals(level(1e6, budgetOf({})), "ok");
  assertEquals(budgetOf({ budget: -3, warnAt: 500 }), { amount: 0, warnAt: 100 });
  assertEquals(shouldNotify(undefined, "2026-10", "warn"), true);
  assertEquals(shouldNotify({ month: "2026-10", level: "warn" }, "2026-10", "warn"), false);
  assertEquals(shouldNotify({ month: "2026-10", level: "warn" }, "2026-10", "over"), true);
  assertEquals(shouldNotify({ month: "2026-09", level: "over" }, "2026-10", "warn"), true);
  assertEquals(shouldNotify({ month: "2026-10", level: "over" }, "2026-10", "ok"), false);
});

Deno.test("formatting", () => {
  assertEquals(money(1234.5), "$1,234.50");
  assertEquals(money(0.5), "$0.50");
  assertEquals(money(0.0042), "$0.0042");
  assertEquals(shortMoney(1234.5), "$1,235");
  assertEquals(shortMoney(12.3), "$12.30");
  assertEquals(tokens(1_234_567), "1.2M");
  assertEquals(tokens(950), "950");
  assertEquals(shortModel("openai/gpt-5"), "gpt-5");
  assertEquals(
    sumDaily([
      { provider: "openai", month: 1, today: 1, daily: { "2026-10-29": 1 }, models: [] },
      { provider: "anthropic", month: 2, today: 2, daily: { "2026-10-29": 2, "2026-10-01": 1 }, models: [] },
    ]),
    { "2026-10-29": 3, "2026-10-01": 1 },
  );
  assert(dailyChart({ "2026-10-29": 3 }, NOW).includes("10-29"));
  assertEquals(dailyChart({}, NOW), "_Nothing spent this month yet._");
  assertEquals(keysOf({ anthropicAdminKey: " sk-ant-admin-x ", openaiAdminKey: "" }), {
    anthropic: "sk-ant-admin-x",
    openai: undefined,
    openrouter: undefined,
  });
});
