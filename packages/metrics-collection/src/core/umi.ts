/**
 * UMI (Uniform Metrics Identifier) — `<Group>:<Metric>:<Duration>`.
 */
import { z } from "zod";

export const UMI_DURATIONS = ["POINT", "HOURLY", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type UmiDuration = (typeof UMI_DURATIONS)[number];

const DURATION_SET = new Set<string>(UMI_DURATIONS);
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

export interface ParsedUmi {
  group: string;
  metric: string;
  duration: UmiDuration;
  isPoint: boolean;
}

export const parsedUmiSchema = z.object({
  group: z.string().min(1),
  metric: z.string().min(1),
  duration: z.enum(UMI_DURATIONS),
  isPoint: z.boolean(),
});

export const umiSchema = z
  .string()
  .min(1, "UMI não pode ser vazio")
  .transform((raw, ctx) => {
    try {
      return parseUmi(raw);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : String(err),
      });
      return z.NEVER;
    }
  });

function validateDotted(name: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`UMI inválido: ${name} não pode ser vazio`);
  }
  for (const segment of value.split(".")) {
    if (!SEGMENT_RE.test(segment)) {
      throw new Error(
        `UMI inválido: segmento "${segment}" de ${name} contém caracteres inválidos ` +
          `(permitidos: letras, dígitos, '-' e '_', separados por '.')`
      );
    }
  }
}

export function parseUmi(raw: string): ParsedUmi {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("UMI inválido: string vazia");
  }
  const parts = raw.split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(
      `UMI inválido "${raw}": esperado formato <Group>:<Metric>[:<Duration>] (2 ou 3 partes separadas por ':')`
    );
  }
  const [group, metric, durationRaw] = parts as [string, string, string | undefined];
  validateDotted("group", group);
  validateDotted("metric", metric);

  let duration: UmiDuration = "POINT";
  if (durationRaw !== undefined) {
    const upper = durationRaw.toUpperCase();
    if (!DURATION_SET.has(upper)) {
      throw new Error(
        `UMI inválido "${raw}": duration "${durationRaw}" desconhecida ` +
          `(válidas: ${UMI_DURATIONS.join(", ")}; omita para POINT)`
      );
    }
    duration = upper as UmiDuration;
  }
  return { group, metric, duration, isPoint: duration === "POINT" };
}

export function serializeUmi(umi: ParsedUmi): string {
  const base = `${umi.group}:${umi.metric}`;
  return umi.duration === "POINT" ? base : `${base}:${umi.duration}`;
}

export function umiFeatureKey(umi: ParsedUmi): string {
  return `${umi.group}:${umi.metric}`;
}

export function isValidUmi(raw: string): boolean {
  try {
    parseUmi(raw);
    return true;
  } catch {
    return false;
  }
}
