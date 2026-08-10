import { BuildManifest, TranslatedStep } from "../types";
import { GenericBuildCommand } from "../core/generic-build-command";
import { BuildAdapter } from "../core/build-translator";

export class PythonAdapter implements BuildAdapter {
  readonly type = "python";

  translate(command: GenericBuildCommand, _manifest: BuildManifest): TranslatedStep[] {
    switch (command.name) {
      case "build":
        return [{ name: "python:build", cmd: "python -m build --wheel --outdir out" }];
      case "test":
        return [{ name: "python:test", cmd: "python -m pytest" }];
      case "package":
      case "verify":
        return [];
    }
  }
}
