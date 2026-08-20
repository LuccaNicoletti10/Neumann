/**
 * event-bus — CLI argv parsing.
 * A lone `--` (pnpm separator leaked into the process) is not a command.
 */
export const EVENT_BUS_COMMANDS = ['demo', 'serve', 'gate'] as const;
export type EventBusCommand = (typeof EVENT_BUS_COMMANDS)[number];

export interface ParsedEventBusArgs {
  command: string | undefined;
  rest: string[];
}

export function parseEventBusArgs(argv: string[]): ParsedEventBusArgs {
  const args = argv.filter((arg) => arg !== '--');
  const [command, ...rest] = args;
  return { command, rest };
}

export function isEventBusCommand(value: string | undefined): value is EventBusCommand {
  return value !== undefined && (EVENT_BUS_COMMANDS as readonly string[]).includes(value);
}
