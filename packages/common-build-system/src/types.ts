import { z } from "zod";

export const GENERIC_COMMANDS = ["build", "test", "package", "verify"] as const;
export type GenericCommandName = (typeof GENERIC_COMMANDS)[number];

export function isGenericCommandName(v: string): v is GenericCommandName {
  return (GENERIC_COMMANDS as readonly string[]).includes(v);
}

export const buildStepSchema = z.object({
  name: z.string().min(1),
  cmd: z.string().min(1),
});
export type BuildStep = z.infer<typeof buildStepSchema>;

export const buildManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  type: z.string().min(1),
  deps: z.array(z.string()).optional().default([]),
  steps: z.array(buildStepSchema).optional().default([]),
  outputs: z.array(z.string()).min(1),
});
export type BuildManifest = z.infer<typeof buildManifestSchema>;

export interface TranslatedStep {
  name: string;
  cmd: string;
}

export interface SignedBuildManifest {
  product: string;
  version: string;
  artifactHash: string; // sha256 sobre (path + hash) dos arquivos, ordenado
  files: Array<{ path: string; hash: string; size: number }>;
  createdAt: string; // ISO-8601
  buildId: string;
}
