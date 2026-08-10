import { BuildManifest, TranslatedStep } from "../types";
import { GenericBuildCommand } from "../core/generic-build-command";
import { BuildAdapter } from "../core/build-translator";

export class ScriptAdapter implements BuildAdapter {
  readonly type = "script";

  translate(command: GenericBuildCommand, manifest: BuildManifest): TranslatedStep[] {
    switch (command.name) {
      case "build":
        return manifest.steps
          .filter((s) => !s.name.startsWith("test"))
          .map((s) => ({ name: s.name, cmd: s.cmd }));
      case "test": {
        const tests = manifest.steps
          .filter((s) => s.name.startsWith("test"))
          .map((s) => ({ name: s.name, cmd: s.cmd }));
        return tests.length > 0
          ? tests
          : [{ name: "test:noop", cmd: "echo 'nenhum teste declarado'" }];
      }
      case "package":
      case "verify":
        return [];
    }
  }
}
