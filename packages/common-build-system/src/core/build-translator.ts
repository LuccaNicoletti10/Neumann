import { BuildManifest, TranslatedStep } from "../types";
import { GenericBuildCommand } from "./generic-build-command";

export interface BuildAdapter {
  readonly type: string;
  translate(command: GenericBuildCommand, manifest: BuildManifest): TranslatedStep[];
}

export class UnknownProductTypeError extends Error {
  constructor(type: string) {
    super(`Nenhum adapter registrado para o tipo de produto '${type}'`);
    this.name = "UnknownProductTypeError";
  }
}

export class BuildTranslator {
  private readonly adapters = new Map<string, BuildAdapter>();

  registerAdapter(adapter: BuildAdapter): this {
    this.adapters.set(adapter.type, adapter);
    return this;
  }

  hasAdapter(type: string): boolean {
    return this.adapters.has(type);
  }

  registeredTypes(): string[] {
    return [...this.adapters.keys()].sort();
  }

  adapterFor(type: string): BuildAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new UnknownProductTypeError(type);
    return adapter;
  }

  translate(command: GenericBuildCommand, manifest: BuildManifest): TranslatedStep[] {
    return this.adapterFor(manifest.type).translate(command, manifest);
  }
}
