import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  alertKey,
  awsCostArgs,
  awsForecastArgs,
  azureForecastBody,
  azureSubscription,
  bar,
  bqArgs,
  budgetStatus,
  classifyError,
  type Costs,
  estimateHetzner,
  fillDays,
  gcpQuery,
  gcpTable,
  hetznerResources,
  isFresh,
  linearForecast,
  money,
  parseAwsCosts,
  parseAzureCosts,
  parseBqCosts,
  parseHetznerPricing,
  period,
  sparkline,
  totals,
  withAwsForecast,
  withAzureForecast,
} from "./lib.ts";

const NOW = new Date("2026-10-29T12:00:00Z");
const P = period(NOW);

Deno.test("the month", () => {
  assertEquals(P, {
    start: "2026-10-01",
    today: "2026-10-29",
    end: "2026-10-30",
    nextMonth: "2026-11-01",
    daysInMonth: 31,
    day: 29,
    invoiceMonth: "202610",
  });
  const dec = period(new Date("2026-12-31T23:00:00Z"));
  assertEquals([dec.end, dec.nextMonth, dec.invoiceMonth], ["2027-01-01", "2027-01-01", "202612"]);
  assertEquals(period(new Date("2028-02-10T00:00:00Z")).daysInMonth, 29);
  assertEquals(fillDays([{ name: "2026-10-02", amount: 3 }], period(new Date("2026-10-03T08:00:00Z"))), [
    { name: "2026-10-01", amount: 0 },
    { name: "2026-10-02", amount: 3 },
    { name: "2026-10-03", amount: 0 },
  ]);
  assertEquals(linearForecast(57, P), 62);
  assertEquals(linearForecast(10, { ...P, day: 1 }), 620);
});

Deno.test("AWS Cost Explorer", () => {
  assertEquals(awsCostArgs(P).slice(0, 4), [
    "ce",
    "get-cost-and-usage",
    "--time-period",
    "Start=2026-10-01,End=2026-10-30",
  ]);
  assertEquals(awsCostArgs(P, "tok").slice(-2), ["--next-page-token", "tok"]);
  assertEquals(awsForecastArgs(P)[3], "Start=2026-10-29,End=2026-11-01");
  const page = (day: string, groups: [string, string][]) => ({
    TimePeriod: { Start: day, End: day },
    Total: {},
    Groups: groups.map(([k, a]) => ({ Keys: [k], Metrics: { UnblendedCost: { Amount: a, Unit: "USD" } } })),
    Estimated: true,
  });
  const costs = parseAwsCosts(
    [
      { ResultsByTime: [page("2026-10-01", [["Amazon EC2", "10.004"], ["AWS Lambda", "0.001"]])] },
      {
        ResultsByTime: [
          page("2026-10-28", [["Amazon EC2", "12"], ["Amazon S3", "1.5"]]),
          page("2026-10-29", [["Amazon EC2", "2"]]),
        ],
      },
    ],
    P,
    1,
  );
  assertEquals(costs.total, 25.5);
  assertEquals(costs.currency, "USD");
  assertEquals(costs.byService, [{ name: "Amazon EC2", amount: 24 }, { name: "Amazon S3", amount: 1.5 }]);
  assertEquals(costs.byDay.length, 29);
  assertEquals(costs.byDay[27], { name: "2026-10-28", amount: 13.5 });
  // Before today (23.5) + Cost Explorer's forecast from today on.
  assertEquals(withAwsForecast(costs, { Total: { Amount: "30.25", Unit: "USD" } }, P).forecast, 53.75);
  assertEquals(withAwsForecast(costs, undefined, P).forecastKind, "linear");
});

Deno.test("Google Cloud billing export", () => {
  assertEquals(
    gcpTable("my-project.billing.gcp_billing_export_v1_01AB"),
    "my-project.billing.gcp_billing_export_v1_01AB",
  );
  assertEquals(gcpTable("`my-project:billing.export`"), "my-project.billing.export");
  assertThrows(() => gcpTable("x; DROP TABLE y"), Error, "not a BigQuery table");
  assertThrows(() => gcpTable("my-project.billing"), Error);
  const sql = gcpQuery("my-project.billing.export", P);
  assert(sql.includes("FROM `my-project.billing.export`"));
  assert(sql.includes("invoice.month = '202610'"));
  assert(sql.includes("UNNEST(credits)"));
  assertEquals(bqArgs("my-project.billing.export", P).slice(0, 6), [
    "query",
    "--use_legacy_sql=false",
    "--format=json",
    "--quiet",
    "--max_rows=100000",
    "--project_id=my-project",
  ]);
  const costs = parseBqCosts(
    [
      { service: "Compute Engine", day: "2026-10-02", currency: "EUR", cost: "12.5" },
      { service: "Cloud Storage", day: "2026-10-02", currency: "EUR", cost: "0.75" },
      { service: "Compute Engine", day: "2026-09-30", currency: "EUR", cost: "1" },
      { service: "Compute Engine", day: "2026-10-28", currency: "EUR", cost: "-0.25" },
    ],
    P,
    1,
  );
  assertEquals(costs.currency, "EUR");
  assertEquals(costs.total, 14);
  assertEquals(costs.byDay[0], { name: "2026-10-01", amount: 1 });
  assertEquals(costs.byService[0], { name: "Compute Engine", amount: 13.25 });
  assertEquals(costs.forecastKind, "linear");
  assertEquals(parseBqCosts(undefined, P, 1).total, 0);
});

Deno.test("Azure Cost Management", () => {
  assertEquals(
    azureSubscription(" /subscriptions/0C3D2F4A-1B2C-4D5E-8F90-123456789ABC "),
    "0c3d2f4a-1b2c-4d5e-8f90-123456789abc",
  );
  assertEquals(azureSubscription(""), undefined);
  assertThrows(() => azureSubscription("my-sub"), Error, "GUID");
  const columns = [
    { name: "Cost", type: "Number" },
    { name: "UsageDate", type: "Number" },
    { name: "ServiceName", type: "String" },
    { name: "Currency", type: "String" },
  ];
  const costs = parseAzureCosts(
    [
      {
        properties: { columns, rows: [[4.5, 20261001, "Virtual Machines", "EUR"], [0.5, 20261001, "Storage", "EUR"]] },
      },
      { properties: { columns, rows: [[2, 20261029, "Virtual Machines", "EUR"]] } },
    ],
    P,
    1,
  );
  assertEquals([costs.total, costs.currency, costs.byService[0].name], [7, "EUR", "Virtual Machines"]);
  const forecast = {
    properties: {
      columns: [{ name: "Cost" }, { name: "UsageDate" }, { name: "CostStatus" }, { name: "Currency" }],
      rows: [[1, "2026-10-29T00:00:00", "Forecast", "EUR"], [1, 20261030, "Forecast", "EUR"], [
        1,
        20261031,
        "Forecast",
        "EUR",
      ]],
    },
  };
  assertEquals(withAzureForecast(costs, forecast, P).forecast, 8);
  assertEquals(withAzureForecast(costs, { properties: { columns: [], rows: [] } }, P).forecastKind, "linear");
  assertEquals(azureForecastBody(P).timePeriod, { from: "2026-10-29T00:00:00Z", to: "2026-10-31T23:59:59Z" });
  const pretax = parseAzureCosts(
    [{
      properties: {
        columns: [{ name: "PreTaxCost" }, { name: "UsageDate" }, { name: "ServiceName" }],
        rows: [[3, 20261005, ""]],
      },
    }],
    P,
    1,
  );
  assertEquals([pretax.total, pretax.byService[0].name, pretax.currency], [3, "Other", "USD"]);
});

const PRICING = {
  pricing: {
    currency: "EUR",
    vat_rate: "19.00",
    server_types: [{
      id: 1,
      name: "cx22",
      prices: [{
        location: "fsn1",
        price_hourly: { net: "0.0060", gross: "0.0071" },
        price_monthly: { net: "3.79", gross: "4.51" },
      }],
    }],
    load_balancer_types: [{
      name: "lb11",
      prices: [{ location: "fsn1", price_hourly: { gross: "0.0098" }, price_monthly: { gross: "6.53" } }],
    }],
    primary_ips: [{
      type: "ipv4",
      prices: [{ location: "fsn1", price_hourly: { gross: "0.0008" }, price_monthly: { gross: "0.60" } }],
    }],
    volume: { price_per_gb_month: { net: "0.0440", gross: "0.0524" } },
    server_backup: { percentage: "20.0000000000" },
  },
};

Deno.test("Hetzner: pricing, resources and the estimate", () => {
  const pricing = parseHetznerPricing(PRICING);
  assertEquals(pricing.servers.cx22.fsn1, { hourly: 0.0071, monthly: 4.51 });
  assertEquals(pricing.volumeGb, 0.0524);
  assertEquals(pricing.backupPercent, 20);
  const resources = hetznerResources(pricing, {
    servers: [
      {
        name: "web",
        created: "2026-01-01T00:00:00Z",
        server_type: { name: "cx22", prices: [] },
        datacenter: { location: { name: "fsn1" } },
        backup_window: "22-02",
      },
      // Created on the 28th at noon: 24 hours so far.
      {
        name: "new",
        created: "2026-10-28T12:00:00Z",
        server_type: { name: "cx22" },
        datacenter: { location: { name: "fsn1" } },
      },
      {
        name: "odd",
        created: "2026-10-01T00:00:00Z",
        server_type: { name: "nope" },
        datacenter: { location: { name: "x" } },
      },
    ],
    volumes: [{ name: "data", size: 100, created: "2026-01-01T00:00:00Z" }],
    loadBalancers: [{
      name: "lb",
      load_balancer_type: { name: "lb11" },
      location: { name: "fsn1" },
      created: "2026-10-29T00:00:00Z",
    }],
    primaryIps: [{
      name: "ip",
      type: "ipv4",
      datacenter: { location: { name: "fsn1" } },
      created: "2026-01-01T00:00:00Z",
    }],
  });
  assertEquals(resources.map((r) => r.kind), [
    "Servers",
    "Backups",
    "Servers",
    "Volumes",
    "Load Balancers",
    "Primary IPs",
  ]);
  const costs = estimateHetzner(resources, pricing.currency, NOW);
  // So far (684 h): web capped at 4.51, its backups 20 %, new 24 h, the volume by the hour, lb 12 h, ip by the hour.
  const web = Math.min(4.51, 684 * 0.0071);
  const expected = web + web * 0.2 + 24 * 0.0071 + Math.min(5.24, (5.24 / 730) * 684) + 12 * 0.0098 + 684 * 0.0008;
  assertEquals(costs.total, Math.round(expected * 100) / 100);
  assertEquals(costs.byService[0].name, "Volumes");
  assertEquals(costs.forecastKind, "estimate");
  assert(costs.forecast! >= costs.total);
  // The month: web and its backups capped, new from the 28th noon (84 h), the volume capped, lb 72 h, ip 744 h.
  assertEquals(costs.forecast, Math.round((4.51 * 1.2 + 84 * 0.0071 + 5.24 + 72 * 0.0098 + 744 * 0.0008) * 100) / 100);
  assertEquals(costs.byDay.length, 29);
  const daySum = costs.byDay.reduce((s, d) => s + d.amount, 0);
  // Each day is rounded to the cent.
  assert(Math.abs(daySum - costs.total) < 0.15, `${daySum} vs ${costs.total}`);
});

const fake = (provider: Costs["provider"], currency: string, total: number, forecast?: number): Costs => ({
  provider,
  currency,
  total,
  forecast,
  byService: [],
  byDay: [],
  fetched: 0,
});

Deno.test("totals and budget", () => {
  const all = [fake("aws", "USD", 120, 200), fake("hetzner", "EUR", 30, 40), fake("gcp", "USD", 30, 50)];
  assertEquals(totals(all), [
    { currency: "USD", total: 150, forecast: 250, providers: ["aws", "gcp"] },
    { currency: "EUR", total: 30, forecast: 40, providers: ["hetzner"] },
  ]);
  assertEquals(totals([fake("aws", "USD", 1), fake("gcp", "USD", 2, 5)])[0].forecast, undefined);
  assertEquals(budgetStatus(all, 0), undefined);
  assertEquals(budgetStatus(all, 1000)?.level, "ok");
  assertEquals(budgetStatus(all, 200)?.level, "forecast");
  assertEquals(budgetStatus(all, 180)?.level, "warn");
  assertEquals(budgetStatus(all, 100)?.level, "over");
  assertEquals(budgetStatus(all, 100)?.ratio, 1.5);
  assertEquals(alertKey(P, "warn"), "2026-10:warn");
});

Deno.test("formatting and cache", () => {
  assertEquals(money(1234.5, "USD"), "$1,234.50");
  assertEquals(money(12.3, "EUR"), "€12.30");
  assertEquals(money(undefined, "EUR"), "–");
  assertEquals(money(5, "ZZ"), "5.00 ZZ");
  assertEquals(sparkline([0, 5, 10]), "▁▅█");
  assertEquals(sparkline([0, 0]), "▁▁");
  assertEquals(bar(0.35), "███▌");
  assertEquals(bar(2), "██████████");
  const t = NOW.getTime();
  assert(isFresh({ fetched: t - 3600_000 }, "aws", t));
  assert(!isFresh({ fetched: t - 7 * 3600_000 }, "aws", t));
  assert(!isFresh({ fetched: t - 2 * 3600_000 }, "hetzner", t));
  assert(!isFresh({ fetched: Date.parse("2026-09-30T23:00:00Z") }, "aws", Date.parse("2026-10-01T01:00:00Z")));
  assert(!isFresh(undefined, "gcp", t));
});

Deno.test("errors", () => {
  assertEquals(classifyError("aws", "An error occurred (ExpiredTokenException)").hint, "aws sso login");
  assertEquals(
    classifyError("aws", "An error occurred (AccessDeniedException) when calling").title,
    "AWS denied Cost Explorer",
  );
  assertEquals(classifyError("azure", "ERROR: Please run 'az login' to setup account.").hint, "az login");
  assertEquals(
    classifyError("gcp", "Not found: Table my-project:billing.x").title,
    "The billing export table was not found",
  );
  assertEquals(classifyError("hetzner", "weird").title, "Hetzner Cloud failed");
});
