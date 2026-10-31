import { assert, assertEquals } from "@std/assert";
import {
  addRun,
  ago,
  apiUrl,
  delta,
  latest,
  looksLikeUrl,
  metric,
  normalizeUrl,
  opportunities,
  parseField,
  parseRun,
  psiError,
  rate,
  removeSite,
  reportUrl,
  type Run,
  scoreColor,
  scoreLine,
  shortUrl,
  type Site,
  sortSites,
  sparkline,
} from "./lib.ts";

// runPagespeed?url=https://web.dev/&strategy=mobile (abridged).
const PSI = {
  captchaResult: "CAPTCHA_NOT_NEEDED",
  kind: "pagespeedonline#result",
  id: "https://web.dev/",
  loadingExperience: {
    id: "https://web.dev/",
    metrics: {
      CUMULATIVE_LAYOUT_SHIFT_SCORE: {
        percentile: 2,
        distributions: [{ min: 0, max: 10, proportion: 0.95 }],
        category: "FAST",
      },
      EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 912, category: "AVERAGE" },
      FIRST_CONTENTFUL_PAINT_MS: { percentile: 1534, category: "FAST" },
      INTERACTION_TO_NEXT_PAINT: { percentile: 156, category: "FAST" },
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2210, category: "FAST" },
    },
    overall_category: "FAST",
    initial_url: "https://web.dev/",
  },
  originLoadingExperience: {
    id: "https://web.dev",
    metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2600, category: "AVERAGE" } },
    overall_category: "AVERAGE",
  },
  lighthouseResult: {
    requestedUrl: "https://web.dev/",
    finalUrl: "https://web.dev/",
    finalDisplayedUrl: "https://web.dev/",
    lighthouseVersion: "12.6.0",
    fetchTime: "2026-10-30T09:12:44.123Z",
    runWarnings: [],
    audits: {
      "first-contentful-paint": {
        id: "first-contentful-paint",
        score: 0.84,
        numericValue: 1803.2,
        displayValue: "1.8 s",
      },
      "largest-contentful-paint": { id: "largest-contentful-paint", score: 0.71, numericValue: 3112.5 },
      "total-blocking-time": { id: "total-blocking-time", score: 0.98, numericValue: 88 },
      "cumulative-layout-shift": { id: "cumulative-layout-shift", score: 1, numericValue: 0.0123 },
      "speed-index": { id: "speed-index", score: 0.9, numericValue: 2950 },
      "render-blocking-resources": {
        title: "Eliminate render-blocking resources",
        score: 0.5,
        displayValue: "Potential savings of 620 ms",
        details: { type: "opportunity", overallSavingsMs: 620 },
      },
      "unused-javascript": {
        title: "Reduce unused JavaScript",
        score: 0,
        details: { type: "opportunity", overallSavingsMs: 1150 },
      },
      "uses-text-compression": {
        title: "Enable text compression",
        score: 1,
        details: { type: "opportunity", overallSavingsMs: 0 },
      },
      "lcp-discovery-insight": {
        title: "LCP request discovery",
        score: 0,
        metricSavings: { LCP: 400, FCP: 0 },
        details: { type: "checklist" },
      },
      "dom-size": { title: "Avoid an excessive DOM size", score: 0.5, details: { type: "table" } },
    },
    categories: {
      performance: { id: "performance", title: "Performance", score: 0.87 },
      accessibility: { id: "accessibility", title: "Accessibility", score: 1 },
      "best-practices": { id: "best-practices", title: "Best Practices", score: 0.96 },
      seo: { id: "seo", title: "SEO", score: 0.92 },
    },
  },
  analysisUTCTimestamp: "2026-10-30T09:12:44.123Z",
};

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("example.com"), { url: "https://example.com/" });
  assertEquals(normalizeUrl(" http://example.com/blog#top "), { url: "http://example.com/blog" });
  assertEquals(normalizeUrl(""), { error: "Type the address of a page" });
  assert("error" in normalizeUrl("localhost:3000"));
  assert("error" in normalizeUrl("http://192.168.1.10"));
  assert("error" in normalizeUrl("nas.lan"));
  assert("error" in normalizeUrl("intranet"));
  assert("error" in normalizeUrl("ftp://example.com"));
  assert(looksLikeUrl("example.com"));
  assert(looksLikeUrl("https://www.example.co.uk/path?q=1"));
  assert(!looksLikeUrl("my blog"));
  assert(!looksLikeUrl("blog"));
  assertEquals(shortUrl("https://www.example.com/"), "example.com");
  assertEquals(shortUrl("https://example.com/blog/"), "example.com/blog");
});

Deno.test("API and report URLs", () => {
  const u = new URL(apiUrl("https://web.dev/", "desktop", "KEY", "fr"));
  assertEquals(u.host, "www.googleapis.com");
  assertEquals(u.pathname, "/pagespeedonline/v5/runPagespeed");
  assertEquals(u.searchParams.get("url"), "https://web.dev/");
  assertEquals(u.searchParams.get("strategy"), "desktop");
  assertEquals(u.searchParams.getAll("category"), ["performance", "accessibility", "best-practices", "seo"]);
  assertEquals(u.searchParams.get("key"), "KEY");
  assertEquals(u.searchParams.get("locale"), "fr");
  assertEquals(new URL(apiUrl("https://web.dev/", "mobile")).searchParams.has("key"), false);
  assertEquals(
    reportUrl("https://web.dev/", "mobile"),
    "https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fweb.dev%2F&form_factor=mobile",
  );
});

Deno.test("a Lighthouse run", () => {
  const run = parseRun(PSI, "mobile", 1000)!;
  assertEquals(run.scores, { performance: 87, accessibility: 100, bestPractices: 96, seo: 92 });
  assertEquals(run.lab, { fcp: 1803.2, lcp: 3112.5, tbt: 88, cls: 0.0123, si: 2950 });
  assertEquals(run.finalUrl, "https://web.dev/");
  assertEquals(run.lighthouse, "12.6.0");
  assertEquals(run.at, 1000);
  assertEquals(run.field?.scope, "url");
  assertEquals(run.field?.overall, "good");
  assertEquals(run.field?.cls, { p75: 0.02, rating: "good" });
  assertEquals(run.field?.inp, { p75: 156, rating: "good" });
  assertEquals(run.field?.ttfb, { p75: 912, rating: "average" });
  assertEquals(run.opportunities.map((o) => o.title), [
    "Reduce unused JavaScript",
    "Eliminate render-blocking resources",
    "LCP request discovery",
  ]);
  assertEquals(parseRun({ error: {} }, "mobile"), undefined);
});

Deno.test("field data: the page's, else the origin's", () => {
  const fallback = parseRun({
    ...PSI,
    loadingExperience: { ...PSI.originLoadingExperience, origin_fallback: true },
  }, "mobile")!;
  assertEquals(fallback.field?.scope, "origin");
  assertEquals(fallback.field?.lcp, { p75: 2600, rating: "average" });

  const noPage = parseRun({ ...PSI, loadingExperience: { id: "https://web.dev/x" } }, "mobile")!;
  assertEquals(noPage.field?.scope, "origin");

  const none = parseRun({ ...PSI, loadingExperience: {}, originLoadingExperience: {} }, "mobile")!;
  assertEquals(none.field, undefined);

  // A percentile without a category is rated with Google's thresholds.
  assertEquals(parseField({ metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 640 } } }, "url")?.inp, {
    p75: 640,
    rating: "poor",
  });
});

Deno.test("opportunities", () => {
  assertEquals(opportunities(undefined), []);
  assertEquals(opportunities(PSI.lighthouseResult.audits, 1).length, 1);
});

Deno.test("errors read like sentences", () => {
  assert(
    psiError(429, { error: { code: 429, message: "Quota exceeded for quota metric 'Queries'" } }).includes("API key"),
  );
  assertEquals(
    psiError(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key." } }),
    "Google refused the API key: check it in Settings",
  );
  assertEquals(
    psiError(500, {
      error: {
        code: 500,
        message:
          "Lighthouse returned error: FAILED_DOCUMENT_REQUEST. Lighthouse was unable to reliably load the page you requested. (Details: net::ERR_CONNECTION_FAILED)",
      },
    }),
    "Lighthouse couldn't load the page: Lighthouse was unable to reliably load the page you requested.",
  );
  assertEquals(
    psiError(400, { error: { message: "Lighthouse returned error: NO_FCP" } }),
    "The page didn't paint anything",
  );
  assertEquals(psiError(502, undefined), "PageSpeed Insights answered 502");
  assert(
    psiError(403, {
      error: { message: "PageSpeed Insights API has not been used in project 123", status: "PERMISSION_DENIED" },
    })
      .startsWith("Enable"),
  );
});

Deno.test("formatting", () => {
  assertEquals(scoreColor(95), "green");
  assertEquals(scoreColor(90), "green");
  assertEquals(scoreColor(72), "orange");
  assertEquals(scoreColor(12), "red");
  assertEquals(scoreColor(undefined), "gray");
  assertEquals(metric("lcp", 3112.5), "3.1 s");
  assertEquals(metric("tbt", 88), "88 ms");
  assertEquals(metric("cls", 0.0123), "0.01");
  assertEquals(metric("cls", 0.005), "< 0.01");
  assertEquals(metric("cls", 0.25), "0.25");
  assertEquals(metric("cls", 0), "0");
  assertEquals(metric("lcp", undefined), "–");
  assertEquals(rate("lcp", 2500), "good");
  assertEquals(rate("cls", 0.2), "average");
  assertEquals(sparkline([0, 50, 100]), "▁▄█");
  assertEquals(delta(90, 85), "+5");
  assertEquals(delta(80, 85), "-5");
  assertEquals(delta(80, 80), "");
  assertEquals(delta(80, undefined), "");
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(ago(now - 30_000, now), "just now");
  assertEquals(ago(now - 3 * 3600_000, now), "3 h ago");
  assertEquals(ago(now - 3 * 86400_000, now), "3 d ago");
  assertEquals(scoreLine(parseRun(PSI, "mobile")!), "Mobile: Perf 87 · A11y 100 · BP 96 · SEO 92");
});

Deno.test("saved sites keep a history per strategy", () => {
  const run = (at: number, strategy: "mobile" | "desktop", perf: number): Run => ({
    ...parseRun(PSI, strategy, at)!,
    scores: { performance: perf },
  });
  let sites: Site[] = [];
  sites = addRun(sites, "https://web.dev/", run(1, "mobile", 70), 3, 1);
  sites = addRun(sites, "https://example.com/", run(2, "desktop", 99), 3, 2);
  sites = addRun(sites, "https://web.dev", run(3, "mobile", 80), 3, 3);
  sites = addRun(sites, "https://web.dev/", run(4, "mobile", 90), 3, 4);
  sites = addRun(sites, "https://web.dev/", run(5, "mobile", 95), 3, 5);
  assertEquals(sites.length, 2);
  assertEquals(sites[0].url, "https://web.dev/");
  assertEquals(sites[0].added, 1);
  assertEquals(sites[0].runs.mobile.map((r) => r.scores.performance), [95, 90, 80]);
  // Only the newest run keeps its opportunities.
  assertEquals(sites[0].runs.mobile[0].opportunities.length, 3);
  assertEquals(sites[0].runs.mobile[1].opportunities, []);
  assertEquals(latest(sites[0], "desktop"), undefined);
  assertEquals(latest(sites[1], "desktop")?.scores.performance, 99);
  assertEquals(sortSites([sites[1], sites[0]]).map((s) => s.url), ["https://web.dev/", "https://example.com/"]);
  assertEquals(removeSite(sites, "https://WEB.dev").map((s) => s.url), ["https://example.com/"]);
});
