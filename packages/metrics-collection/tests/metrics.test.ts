import { describe, expect, it } from "vitest";
import { parseUmi, serializeUmi, isValidUmi } from "../src/core/umi.js";
import { CategorizationModule, globToRegex, matchesPattern } from "../src/core/categorization-module.js";
import { MetricsCollectionSystem } from "../src/core/metrics-system.js";
import { makeThresholdCountScoringFunction } from "../src/core/scoring-module.js";
import { buildServer } from "../src/server/index.js";

describe("UMI", () => {
  it("parseia POINT e durations", () => {
    expect(parseUmi("foundry.workspace:views.count")).toEqual({
      group: "foundry.workspace",
      metric: "views.count",
      duration: "POINT",
      isPoint: true,
    });
    const weekly = parseUmi("foundry.workspace.documents:views.count:WEEKLY");
    expect(weekly.duration).toBe("WEEKLY");
    expect(weekly.isPoint).toBe(false);
    expect(serializeUmi(weekly)).toBe("foundry.workspace.documents:views.count:WEEKLY");
  });

  it("rejeita UMI inválido", () => {
    expect(isValidUmi("")).toBe(false);
    expect(isValidUmi("onlyone")).toBe(false);
    expect(isValidUmi("a:b:YEARLY")).toBe(false);
  });
});

describe("CategorizationModule", () => {
  it("classifica por padrões e metrics type", () => {
    const cat = new CategorizationModule();
    expect(cat.metricsTypeOf("app:logins")).toBe("point");
    expect(cat.metricsTypeOf("app:logins:DAILY")).toBe("duration");
    expect(cat.categorize("app:views.count")).toContain("engagement");
    expect(cat.categorize("app:errors.total")).toContain("issues");
    expect(matchesPattern("*:views*", "x:views.count")).toBe(true);
    expect(globToRegex("a:*").test("a:b")).toBe(true);
  });
});

describe("MetricsCollectionSystem", () => {
  it("submete, pontua e visualiza", () => {
    const t0 = Date.parse("2026-01-10T00:00:00.000Z");
    const system = new MetricsCollectionSystem({
      now: () => t0,
      metricsOnMetrics: false,
    });

    system.submit({
      deploymentId: "dep-a",
      product: "foundry",
      submittedAt: t0,
      metrics: [
        { umi: "app:views.count", value: 10 },
        { umi: "app:logins", value: 5 },
        { umi: "app:errors.total", value: 2 },
      ],
    });
    system.submit({
      deploymentId: "dep-b",
      product: "foundry",
      submittedAt: t0 + 86_400_000,
      metrics: [{ umi: "app:views.count", value: 20 }],
    });

    expect(system.getScore({ category: "engagement", deploymentId: "dep-a" })).toBe(15);
    expect(system.scoring.rankDeployments("engagement")[0]!.deploymentId).toBe("dep-b");

    system.registerScoringFunction(
      "engagement",
      makeThresholdCountScoringFunction({
        umiPattern: "*:views*",
        threshold: 15,
        pointsPerDevice: 3,
      })
    );
    // dep-b tem views=20 > 15 → +3
    expect(system.getScore({ category: "engagement", deploymentId: "dep-b" })).toBe(23);

    const viz = system.getVisualizationData({
      visualizationType: "bar",
      category: "engagement",
      timePeriod: { from: t0, to: t0 + 3 * 86_400_000 },
      bucket: "day",
    });
    expect(viz.grandTotal).toBeGreaterThan(0);
    expect(viz.series.some((s) => s.key === "dep-a")).toBe(true);
    const html = system.visualization.renderHtml(viz);
    expect(html).toContain("<svg");
  });

  it("scheduler tick entrega request ao data source", async () => {
    const now = Date.parse("2026-02-01T00:00:00.000Z");
    const system = new MetricsCollectionSystem({ now: () => now, metricsOnMetrics: false });
    system.collection.setInterval({
      deploymentId: "dep-x",
      feature: "app:views.count",
      product: "foundry",
      rate: "DAILY",
    });
    let queried = 0;
    system.registerDataSource("dep-x", {
      query: () => {
        queried++;
        return [
          {
            deploymentId: "dep-x",
            product: "foundry",
            metrics: [{ umi: "app:views.count", value: 7 }],
          },
        ];
      },
    });
    const delivered = await system.collection.tick(now);
    expect(delivered).toHaveLength(1);
    expect(queried).toBe(1);
    expect(system.getScore({ category: "engagement", deploymentId: "dep-x" })).toBe(7);
  });
});

describe("API HTTP", () => {
  it("POST /submissions e GET /scores", async () => {
    const system = new MetricsCollectionSystem({ metricsOnMetrics: false });
    const app = buildServer(system);
    await app.ready();

    const sub = await app.inject({
      method: "POST",
      url: "/submissions",
      payload: {
        deploymentId: "d1",
        product: "p1",
        metrics: [{ umi: "app:logins", value: 4 }],
      },
    });
    expect(sub.statusCode).toBe(201);

    const score = await app.inject({
      method: "GET",
      url: "/scores?category=engagement&deploymentId=d1",
    });
    expect(score.json().score).toBe(4);

    await app.close();
  });
});
