import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import { DocumentSchema, type RepositoryDocument } from "./types.js";

export class DocumentRepository {
  private documents = new Map<string, RepositoryDocument>();

  constructor(
    private readonly docsDir: string,
    private readonly logger?: Logger,
  ) {
    this.reload();
  }

  reload(): void {
    this.documents.clear();
    const files = readdirSync(this.docsDir)
      .filter((f) => f.endsWith(".json"))
      .sort(); // ordem estável

    for (const file of files) {
      const fullPath = join(this.docsDir, file);
      const raw: unknown = JSON.parse(readFileSync(fullPath, "utf8"));
      const parsed = DocumentSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Documento inválido em ${file}: ${parsed.error.message}`,
        );
      }
      if (this.documents.has(parsed.data.id)) {
        throw new Error(`ID de documento duplicado: ${parsed.data.id} (${file})`);
      }
      this.documents.set(parsed.data.id, parsed.data);
      this.logger?.debug({ file, id: parsed.data.id }, "documento carregado");
    }
    this.logger?.info(
      { dir: this.docsDir, count: this.documents.size },
      "DocumentRepository carregado",
    );
  }

  list(): RepositoryDocument[] {
    return [...this.documents.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }

  get(id: string): RepositoryDocument | undefined {
    return this.documents.get(id);
  }
}
