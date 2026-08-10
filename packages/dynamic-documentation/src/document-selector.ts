import semver from "semver";
import type { DocumentRepository } from "./document-repository.js";
import type {
  ApplicationInstance,
  InstalledService,
  RepositoryDocument,
  SelectedDocument,
} from "./types.js";

export class DocumentSelector {
  constructor(private readonly repository: DocumentRepository) {}

  requiredServices(doc: RepositoryDocument): string[] {
    return doc.requires ?? [doc.service!];
  }

  select(instance: ApplicationInstance): SelectedDocument[] {
    const installed = new Map<string, InstalledService>(
      instance.services.map((s) => [s.name, s]),
    );

    const selected: SelectedDocument[] = [];
    for (const doc of this.repository.list()) {
      const required = this.requiredServices(doc);
      // Overlap docs: TODOS os serviços requeridos precisam estar instalados.
      if (!required.every((name) => installed.has(name))) continue;

      const subsections = doc.subsections
        .filter((sub) => {
          const range = sub.versions ?? "*";
          const targetService = sub.service ?? required[0]!;
          const version = installed.get(targetService)?.version;
          if (!version) return false;
          return semver.satisfies(version, range, {
            includePrerelease: true,
          });
        })
        .map((sub) => ({ id: sub.id, title: sub.title, body: sub.body }));

      selected.push({
        id: doc.id,
        title: doc.title,
        body: doc.body,
        coveredServices: required.map((name) => installed.get(name)!),
        subsections,
      });
    }
    // Ordem estável e determinística (por id de documento).
    return selected.sort((a, b) => a.id.localeCompare(b.id));
  }
}
