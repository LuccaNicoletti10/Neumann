import { BuildManifest, TranslatedStep } from "../types";
import { GenericBuildCommand } from "../core/generic-build-command";
import { BuildAdapter } from "../core/build-translator";

export class NodeTsAdapter implements BuildAdapter {
  readonly type = "node-ts";

  translate(command: GenericBuildCommand, _manifest: BuildManifest): TranslatedStep[] {
    switch (command.name) {
      case "build":
      case "test":
        return [{ name: `npm:${command.name}`, cmd: `npm run ${command.name} --silent` }];
      case "package":
      case "verify":
        // Empacotamento uniforme é responsabilidade do DistPackager (core).
        return [];
    }
  }
}
