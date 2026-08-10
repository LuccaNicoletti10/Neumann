/**
 * VisualizationModule — bar / line / heatmap / table (JSON + HTML/SVG).
 */
import type { MetricsStore, MetricPoint } from "./metrics-store.js";
import type { CategorizationModule } from "./categorization-module.js";

export type VisualizationType = "bar" | "line" | "heatmap" | "table";
export type BucketSize = "day" | "week";

export interface VisualizationRequest {
  visualizationType: VisualizationType;
  category?: string;
  deploymentId?: string;
  product?: string;
  timePeriod: { from: number; to: number };
  bucket?: BucketSize;
}

export interface TimeBucket {
  start: number;
  end: number;
  label: string;
}

export interface VisualizationSeries {
  key: string;
  values: number[];
  total: number;
}

export interface VisualizationData {
  type: VisualizationType;
  category?: string;
  bucket: BucketSize;
  timePeriod: { from: number; to: number };
  buckets: TimeBucket[];
  series: VisualizationSeries[];
  grandTotal: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function startOfUtcDay(ts: number): number {
  return Math.floor(ts / DAY_MS) * DAY_MS;
}

function startOfUtcWeek(ts: number): number {
  const day = startOfUtcDay(ts);
  const dow = new Date(day).getUTCDay();
  const offset = (dow + 6) % 7;
  return day - offset * DAY_MS;
}

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function buildBuckets(from: number, to: number, size: BucketSize): TimeBucket[] {
  const step = size === "day" ? DAY_MS : WEEK_MS;
  const align = size === "day" ? startOfUtcDay : startOfUtcWeek;
  const buckets: TimeBucket[] = [];
  let cursor = align(from);
  while (cursor < to) {
    const end = cursor + step;
    buckets.push({
      start: cursor,
      end,
      label: size === "day" ? fmtDate(cursor) : `semana de ${fmtDate(cursor)}`,
    });
    cursor = end;
  }
  return buckets;
}

export class VisualizationModule {
  constructor(
    private readonly store: MetricsStore,
    private readonly categorization: CategorizationModule
  ) {}

  private filterPoints(request: VisualizationRequest): MetricPoint[] {
    const { from, to } = request.timePeriod;
    return this.store.getPoints().filter((p) => {
      if (p.timestamp < from || p.timestamp >= to) return false;
      if (request.deploymentId !== undefined && p.deploymentId !== request.deploymentId)
        return false;
      if (request.product !== undefined && p.product !== request.product) return false;
      if (request.category !== undefined) {
        return this.categorization.categorize(p.parsed).includes(request.category);
      }
      return true;
    });
  }

  getData(request: VisualizationRequest): VisualizationData {
    const { from, to } = request.timePeriod;
    if (!(from < to)) throw new Error("timePeriod inválido: 'from' deve ser anterior a 'to'");
    const bucket: BucketSize =
      request.bucket ?? (to - from > 62 * DAY_MS ? "week" : "day");
    const buckets = buildBuckets(from, to, bucket);
    const points = this.filterPoints(request);

    const keyOf = (p: MetricPoint): string =>
      request.deploymentId === undefined ? p.deploymentId : p.umi;

    const seriesMap = new Map<string, number[]>();
    for (const p of points) {
      const key = keyOf(p);
      let values = seriesMap.get(key);
      if (!values) {
        values = buckets.map(() => 0);
        seriesMap.set(key, values);
      }
      const idx = buckets.findIndex((b) => p.timestamp >= b.start && p.timestamp < b.end);
      if (idx >= 0) values[idx] = (values[idx] as number) + p.value;
    }

    const series: VisualizationSeries[] = [...seriesMap.entries()]
      .map(([key, values]) => ({
        key,
        values,
        total: values.reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total);

    const data: VisualizationData = {
      type: request.visualizationType,
      bucket,
      timePeriod: { from, to },
      buckets,
      series,
      grandTotal: series.reduce((a, s) => a + s.total, 0),
    };
    if (request.category !== undefined) data.category = request.category;
    return data;
  }

  renderHtml(data: VisualizationData, title = "Métricas de uso"): string {
    const body =
      data.type === "bar"
        ? renderBarSvg(data)
        : data.type === "line"
          ? renderLineSvg(data)
          : data.type === "heatmap"
            ? renderHeatmapSvg(data)
            : renderTable(data);
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
  h1 { font-size: 1.25rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 1rem; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 4px 10px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="meta">tipo: ${esc(data.type)} | bucket: ${esc(data.bucket)} | total: ${data.grandTotal}</div>
${body}
<script type="application/json" id="viz-data">${json}</script>
</body>
</html>`;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PALETTE = [
  "#3366cc",
  "#dc3912",
  "#ff9900",
  "#109618",
  "#990099",
  "#0099c6",
  "#dd4477",
  "#66aa00",
];

function colorAt(i: number): string {
  return PALETTE[i % PALETTE.length] as string;
}

function renderBarSvg(data: VisualizationData): string {
  const width = 720;
  const rowH = 34;
  const labelW = 220;
  const height = Math.max(60, data.series.length * rowH + 30);
  const max = Math.max(1, ...data.series.map((s) => s.total));
  const rows = data.series
    .map((s, i) => {
      const y = 10 + i * rowH;
      const w = Math.round(((width - labelW - 70) * s.total) / max);
      return (
        `<text x="${labelW - 8}" y="${y + 18}" text-anchor="end" font-size="12">${esc(s.key)}</text>` +
        `<rect x="${labelW}" y="${y}" width="${w}" height="24" fill="${colorAt(i)}"><title>${esc(s.key)}: ${s.total}</title></rect>` +
        `<text x="${labelW + w + 6}" y="${y + 17}" font-size="12">${s.total}</text>`
      );
    })
    .join("\n");
  return `<svg width="${width}" height="${height}" role="img">\n${rows}\n</svg>`;
}

function renderLineSvg(data: VisualizationData): string {
  const width = 720;
  const height = 320;
  const padL = 50;
  const padB = 40;
  const padT = 10;
  const plotW = width - padL - 20;
  const plotH = height - padT - padB;
  const max = Math.max(1, ...data.series.flatMap((s) => s.values));
  const n = Math.max(1, data.buckets.length);
  const xAt = (i: number): number => padL + plotW * (n === 1 ? 0.5 : i / (n - 1));
  const yAt = (v: number): number => padT + plotH - (plotH * v) / max;
  const lines = data.series
    .map((s, i) => {
      const pts = s.values
        .map((v, j) => `${xAt(j).toFixed(1)},${yAt(v).toFixed(1)}`)
        .join(" ");
      return `<polyline fill="none" stroke="${colorAt(i)}" stroke-width="2" points="${pts}"><title>${esc(s.key)}</title></polyline>`;
    })
    .join("\n");
  const xlabels = data.buckets
    .map(
      (b, i) =>
        `<text x="${xAt(i).toFixed(1)}" y="${height - 18}" text-anchor="middle" font-size="10">${esc(b.label)}</text>`
    )
    .join("\n");
  const legend = data.series
    .map(
      (s, i) =>
        `<text x="${padL + i * 160}" y="${height - 4}" font-size="11" fill="${colorAt(i)}">${esc(s.key)}</text>`
    )
    .join("\n");
  const axis =
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#999"/>` +
    `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#999"/>` +
    `<text x="8" y="${yAt(max).toFixed(1)}" font-size="10">${max}</text><text x="8" y="${yAt(0).toFixed(1)}" font-size="10">0</text>`;
  return `<svg width="${width}" height="${height}" role="img">\n${axis}\n${lines}\n${xlabels}\n${legend}\n</svg>`;
}

function renderHeatmapSvg(data: VisualizationData): string {
  const cell = 26;
  const labelW = 220;
  const labelH = 78;
  const width = labelW + data.buckets.length * cell + 20;
  const height = labelH + data.series.length * cell + 10;
  const max = Math.max(1, ...data.series.flatMap((s) => s.values));
  const cells = data.series
    .map((s, r) => {
      const y = labelH + r * cell;
      const rowLabel = `<text x="${labelW - 6}" y="${y + 17}" text-anchor="end" font-size="11">${esc(s.key)}</text>`;
      const rects = s.values
        .map((v, c) => {
          const intensity = v / max;
          const fill =
            intensity === 0
              ? "#f2f2f2"
              : `rgba(51,102,204,${(0.15 + 0.85 * intensity).toFixed(2)})`;
          return `<rect x="${labelW + c * cell}" y="${y}" width="${cell - 2}" height="${cell - 2}" fill="${fill}"><title>${esc(s.key)} / ${esc(data.buckets[c]?.label ?? "")}: ${v}</title></rect>`;
        })
        .join("");
      return rowLabel + rects;
    })
    .join("\n");
  const colLabels = data.buckets
    .map((b, c) => {
      const x = labelW + c * cell + cell / 2;
      return `<text x="${x}" y="${labelH - 6}" text-anchor="end" font-size="9" transform="rotate(-45 ${x} ${labelH - 6})">${esc(b.label)}</text>`;
    })
    .join("\n");
  return `<svg width="${width}" height="${height}" role="img">\n${colLabels}\n${cells}\n</svg>`;
}

function renderTable(data: VisualizationData): string {
  const header = `<tr><th>série</th>${data.buckets.map((b) => `<th>${esc(b.label)}</th>`).join("")}<th>total</th></tr>`;
  const rows = data.series
    .map(
      (s) =>
        `<tr><td>${esc(s.key)}</td>${s.values.map((v) => `<td>${v}</td>`).join("")}<td><strong>${s.total}</strong></td></tr>`
    )
    .join("\n");
  return `<table>\n${header}\n${rows}\n</table>`;
}
