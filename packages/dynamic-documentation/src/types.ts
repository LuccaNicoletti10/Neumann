import { z } from "zod";

export const SubsectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  versions: z.string().min(1).optional(),
  service: z.string().min(1).optional(),
});

export const DocumentSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    service: z.string().min(1).optional(),
    requires: z.array(z.string().min(1)).min(2).optional(),
    body: z.string(),
    subsections: z.array(SubsectionSchema).default([]),
  })
  .refine((d) => (d.service !== undefined) !== (d.requires !== undefined), {
    message: "Documento deve ter exatamente um de: 'service' ou 'requires'",
  });

export type Subsection = z.infer<typeof SubsectionSchema>;
export type RepositoryDocument = z.infer<typeof DocumentSchema>;

export const InstalledServiceSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  installedAt: z.string().min(1), // ISO timestamp
});
export type InstalledService = z.infer<typeof InstalledServiceSchema>;

export const ApplicationInstanceSchema = z.object({
  instanceId: z.string().min(1),
  services: z.array(InstalledServiceSchema),
});
export type ApplicationInstance = z.infer<typeof ApplicationInstanceSchema>;

export const InstallServiceBodySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});
export type InstallServiceBody = z.infer<typeof InstallServiceBodySchema>;

// ---- Saídas do pipeline de seleção/construção ----

export interface SelectedSubsection {
  id: string;
  title: string;
  body: string;
}

export interface SelectedDocument {
  id: string;
  title: string;
  body: string;
  coveredServices: InstalledService[];
  subsections: SelectedSubsection[];
}

export interface DynamicDocumentation {
  instanceId: string;
  generatedAt: string;
  services: InstalledService[];
  documents: SelectedDocument[];
}
