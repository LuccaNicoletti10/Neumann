import { EventEmitter } from "node:events";
import semver from "semver";
import type {
  ApplicationInstance,
  InstalledService,
} from "./types.js";

export interface ServicesChangedEvent {
  instanceId: string;
  action: "install" | "upgrade" | "uninstall" | "create";
  service?: string;
}

export class ServiceRegistry extends EventEmitter {
  private instances = new Map<string, Map<string, InstalledService>>();

  createInstance(instanceId: string): ApplicationInstance {
    if (!this.instances.has(instanceId)) {
      this.instances.set(instanceId, new Map());
      this.emitChanged({ instanceId, action: "create" });
    }
    return this.getInstance(instanceId)!;
  }

  hasInstance(instanceId: string): boolean {
    return this.instances.has(instanceId);
  }

  getInstance(instanceId: string): ApplicationInstance | undefined {
    const services = this.instances.get(instanceId);
    if (!services) return undefined;
    return {
      instanceId,
      services: [...services.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    };
  }

  listInstances(): ApplicationInstance[] {
    return [...this.instances.keys()]
      .sort()
      .map((id) => this.getInstance(id)!);
  }

  install(
    instanceId: string,
    name: string,
    version: string,
    installedAt: Date = new Date(),
  ): { action: "install" | "upgrade"; service: InstalledService } {
    const clean = semver.valid(version);
    if (!clean) {
      throw new Error(`Versão semver inválida: "${version}"`);
    }
    if (!this.instances.has(instanceId)) {
      this.instances.set(instanceId, new Map());
    }
    const services = this.instances.get(instanceId)!;
    const existing = services.get(name);
    const action: "install" | "upgrade" =
      existing && existing.version !== clean ? "upgrade" : "install";
    const service: InstalledService = {
      name,
      version: clean,
      installedAt: installedAt.toISOString(),
    };
    services.set(name, service);
    this.emitChanged({ instanceId, action, service: name });
    return { action, service };
  }

  uninstall(instanceId: string, name: string): boolean {
    const services = this.instances.get(instanceId);
    if (!services || !services.delete(name)) return false;
    this.emitChanged({ instanceId, action: "uninstall", service: name });
    return true;
  }

  installedVersion(instanceId: string, name: string): string | undefined {
    return this.instances.get(instanceId)?.get(name)?.version;
  }

  private emitChanged(event: ServicesChangedEvent): void {
    this.emit("servicesChanged", event);
  }
}
