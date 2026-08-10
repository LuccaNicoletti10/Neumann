import { GENERIC_COMMANDS, GenericCommandName, isGenericCommandName } from "../types";

export class GenericBuildCommand {
  readonly name: GenericCommandName;

  constructor(name: string) {
    if (!isGenericCommandName(name)) {
      throw new Error(
        `Comando genérico inválido: "${name}". Válidos: ${GENERIC_COMMANDS.join(", ")}`
      );
    }
    this.name = name;
  }

  static build(): GenericBuildCommand {
    return new GenericBuildCommand("build");
  }
  static test(): GenericBuildCommand {
    return new GenericBuildCommand("test");
  }
  static package(): GenericBuildCommand {
    return new GenericBuildCommand("package");
  }
  static verify(): GenericBuildCommand {
    return new GenericBuildCommand("verify");
  }

  toString(): string {
    return `generic:${this.name}`;
  }
}
