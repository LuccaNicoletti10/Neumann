/**
 * API HTTP (fastify) — submissão, intervals, categorias, scores, visualizações.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { MetricsCollectionSystem } from "../core/metrics-system.js";
import { SYSTEM_DEPLOYMENT_ID } from "../core/metrics-system.js";
import type { VisualizationType } from "../core/visualization-module.js";

const manualSubmissionSchema = z.object({
  deploymentId: z.string().min(1),
  product: z.string().min(1),
  dateOfReport: z.union([z.string().min(1), z.number()]).optional(),
  sourceId: z.string().min(1).optional(),
  metrics: z
    .array(z.object({ umi: z.string().min(1), value: z.number().finite() }))
    .min(1),
});

function parseTime(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return Number(value);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface BuildServerOptions {
  logger?: boolean;
}

export function buildServer(
  system: MetricsCollectionSystem,
  options: BuildServerOptions = {}
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 400;
    void reply.status(status).send({ error: err.message });
  });

  app.post("/submissions", async (req, reply) => {
    const body = manualSubmissionSchema.parse(req.body);
    const dateOfReport = parseTime(body.dateOfReport);
    const result = system.submit({
      deploymentId: body.deploymentId,
      product: body.product,
      ...(body.sourceId !== undefined ? { sourceId: body.sourceId } : {}),
      ...(dateOfReport !== undefined ? { submittedAt: dateOfReport } : {}),
      metrics: body.metrics,
    });
    return reply.status(201).send({ accepted: result.accepted });
  });

  app.post("/intervals", async (req, reply) => {
    const def = system.collection.setInterval(req.body);
    return reply.status(201).send(def);
  });

  app.get("/intervals", async () => system.collection.listIntervals());

  app.get("/categories", async () => system.listCategories());

  app.post("/categories", async (req, reply) => {
    const body = z
      .object({
        categoryId: z.string().min(1),
        featurePatterns: z.array(z.string().min(1)).min(1),
      })
      .parse(req.body);
    const existing = system.listCategories().find((c) => c.categoryId === body.categoryId);
    if (existing) {
      for (const p of body.featurePatterns) system.addFeatureToCategory(body.categoryId, p);
    } else {
      system.addCategory(body);
    }
    return reply
      .status(201)
      .send(system.listCategories().find((c) => c.categoryId === body.categoryId));
  });

  app.get("/scores", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.category) return { error: "parâmetro 'category' é obrigatório" };
    const score = system.getScore({
      category: q.category,
      ...(q.deploymentId !== undefined ? { deploymentId: q.deploymentId } : {}),
      ...(q.product !== undefined ? { product: q.product } : {}),
    });
    return {
      category: q.category,
      deploymentId: q.deploymentId ?? null,
      product: q.product ?? null,
      score,
    };
  });

  app.get("/scores/ranking", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.category) return { error: "parâmetro 'category' é obrigatório" };
    return { category: q.category, ranking: system.scoring.rankDeployments(q.category) };
  });

  interface VizParams {
    type: VisualizationType;
    category?: string;
    deploymentId?: string;
    product?: string;
    from: number;
    to: number;
    bucket?: "day" | "week";
  }

  function vizParams(query: Record<string, string | undefined>): VizParams {
    const type = (query.type ?? "bar") as VisualizationType;
    if (!["bar", "line", "heatmap", "table"].includes(type)) {
      throw new Error(`visualizationType inválido: ${String(query.type)}`);
    }
    const to = parseTime(query.to) ?? Date.now();
    const from = parseTime(query.from) ?? to - 30 * 24 * 60 * 60 * 1000;
    const bucket = query.bucket === "day" || query.bucket === "week" ? query.bucket : undefined;
    const params: VizParams = { type, from, to };
    if (query.category !== undefined) params.category = query.category;
    if (query.deploymentId !== undefined) params.deploymentId = query.deploymentId;
    if (query.product !== undefined) params.product = query.product;
    if (bucket !== undefined) params.bucket = bucket;
    return params;
  }

  app.get("/visualizations", async (req) => {
    const { type, from, to, ...rest } = vizParams(
      req.query as Record<string, string | undefined>
    );
    return system.getVisualizationData({
      visualizationType: type,
      timePeriod: { from, to },
      ...rest,
    });
  });

  app.get("/visualizations/html", async (req, reply) => {
    const { type, from, to, ...rest } = vizParams(
      req.query as Record<string, string | undefined>
    );
    const title = `Visualização ${type}${rest.category ? ` — ${rest.category}` : ""}`;
    const html = system.renderVisualizationHtml(
      { visualizationType: type, timePeriod: { from, to }, ...rest },
      title
    );
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/deployments", async () => system.listDeployments());

  app.get("/products", async () => system.listProducts());

  app.get("/", async (_req, reply) => {
    const now = Date.now();
    const from = now - 90 * 24 * 60 * 60 * 1000;
    const links = [
      {
        label: "Explorar por deployment (bar)",
        href: `/visualizations/html?type=bar&from=${from}&to=${now}`,
      },
      {
        label: "Explorar por produto (heatmap semanal)",
        href: `/visualizations/html?type=heatmap&bucket=week&from=${from}&to=${now}`,
      },
      {
        label: "Metrics-on-metrics (line, uso do próprio sistema)",
        href: `/visualizations/html?type=line&deploymentId=${encodeURIComponent(SYSTEM_DEPLOYMENT_ID)}&from=${from}&to=${now}`,
      },
    ];
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Metrics Collection</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem}li{margin:.5rem 0}</style></head>
<body>
<h1>Sistema de coleta e visualização de métricas de uso</h1>
<ul>
${links.map((l) => `  <li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join("\n")}
</ul>
</body>
</html>`;
    return reply.type("text/html; charset=utf-8").send(html);
  });

  return app;
}
