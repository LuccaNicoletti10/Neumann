import type { Logger } from "pino";
import { DocumentationBuilder } from "./documentation-builder.js";
import { DocumentSelector } from "./document-selector.js";
import {
  ServiceRegistry,
  type ServicesChangedEvent,
} from "./service-registry.js";
import type { DynamicDocumentation } from "./types.js";

export interface CompiledDocumentation {
  structure: DynamicDocumentation;
  markdown: string;
}

export class DocWatcher {
  private readonly cache = new Map<string, CompiledDocumentation>();
  private readonly selector: DocumentSelector;
  private readonly builder = new DocumentationBuilder();

  constructor(
    private readonly registry: ServiceRegistry,
    selector: DocumentSelector,
    private readonly logger?: Logger,
  ) {
    this.selector = selector;
    this.registry.on("servicesChanged", (event: ServicesChangedEvent) => {
      if (event.action !== "create") {
        this.onServicesChanged(event.instanceId);
      } else {
        this.cache.delete(event.instanceId);
      }
    });
  }

  onServicesChanged(instanceId: string): CompiledDocumentation | undefined {
    this.cache.delete(instanceId);
    this.logger?.info(
      { instanceId },
      "cache invalidado; recompilando documentação",
    );
    return this.compile(instanceId);
  }

  getDocumentation(instanceId: string): CompiledDocumentation | undefined {
    const cached = this.cache.get(instanceId);
    if (cached) return cached;
    return this.compile(instanceId);
  }

  private compile(instanceId: string): CompiledDocumentation | undefined {
    const instance = this.registry.getInstance(instanceId);
    if (!instance) return undefined;
    const selected = this.selector.select(instance);
    const structure = this.builder.buildStructure(
      instanceId,
      instance.services,
      selected,
    );
    const markdown = this.builder.buildMarkdown(structure);
    const compiled: CompiledDocumentation = { structure, markdown };
    this.cache.set(instanceId, compiled);
    return compiled;
  }
}
