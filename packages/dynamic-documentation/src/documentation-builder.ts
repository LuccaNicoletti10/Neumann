import type {
  DynamicDocumentation,
  InstalledService,
  SelectedDocument,
} from "./types.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export class DocumentationBuilder {
  buildStructure(
    instanceId: string,
    services: InstalledService[],
    documents: SelectedDocument[],
    generatedAt: Date = new Date(),
  ): DynamicDocumentation {
    const sortedServices = [...services].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const sortedDocs = [...documents].sort((a, b) => a.id.localeCompare(b.id));
    return {
      instanceId,
      generatedAt: generatedAt.toISOString(),
      services: sortedServices,
      documents: sortedDocs,
    };
  }

  buildMarkdown(doc: DynamicDocumentation): string {
    const lines: string[] = [];

    // ---- Cabeçalho ----
    lines.push(`# Documentação Dinâmica — Instância \`${doc.instanceId}\``);
    lines.push("");
    lines.push(`- Gerado em: ${doc.generatedAt}`);
    lines.push(
      `- Serviços cobertos (${doc.services.length}): ${
        doc.services.length === 0
          ? "nenhum"
          : doc.services.map((s) => `\`${s.name}@${s.version}\``).join(", ")
      }`,
    );
    lines.push("");

    // ---- Índice (TOC) ----
    lines.push("## Índice");
    lines.push("");
    if (doc.documents.length === 0) {
      lines.push("_Nenhum documento aplicável aos serviços instalados._");
    }
    for (const document of doc.documents) {
      lines.push(`- [${document.title}](#${slugify(document.title)})`);
      for (const sub of document.subsections) {
        lines.push(`  - [${sub.title}](#${slugify(sub.title)})`);
      }
    }
    lines.push("");

    // ---- Corpo ----
    for (const document of doc.documents) {
      lines.push(`## ${document.title}`);
      lines.push("");
      lines.push(
        `_Serviços: ${document.coveredServices
          .map((s) => `\`${s.name}@${s.version}\``)
          .join(", ")}_`,
      );
      lines.push("");
      lines.push(document.body);
      lines.push("");
      for (const sub of document.subsections) {
        lines.push(`### ${sub.title}`);
        lines.push("");
        lines.push(sub.body);
        lines.push("");
      }
    }

    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
}
