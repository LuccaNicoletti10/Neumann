import { BuildTranslator } from "../core/build-translator";
import { ScriptAdapter } from "./script-adapter";
import { NodeTsAdapter } from "./node-ts-adapter";
import { PythonAdapter } from "./python-adapter";

export { ScriptAdapter } from "./script-adapter";
export { NodeTsAdapter } from "./node-ts-adapter";
export { PythonAdapter } from "./python-adapter";

export function createDefaultTranslator(): BuildTranslator {
  return new BuildTranslator()
    .registerAdapter(new ScriptAdapter())
    .registerAdapter(new NodeTsAdapter())
    .registerAdapter(new PythonAdapter());
}
