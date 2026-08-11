/**
 * connector-postgres — src/core/cursor.ts
 * Cursor opaco (JSON) para snapshot resumível e CDC.
 */

export type PgCursorState =
  | { kind: 'empty' }
  | { kind: 'snapshot'; object: string; lastPk: string | null }
  | { kind: 'cdc'; object: string; updatedAt: string; lastPk: string };

export function encodeCursor(state: PgCursorState): string {
  return JSON.stringify(state);
}

export function decodeCursor(token: string | undefined | null): PgCursorState {
  if (!token) return { kind: 'empty' };
  try {
    const parsed = JSON.parse(token) as PgCursorState;
    if (parsed && typeof parsed === 'object' && 'kind' in parsed) return parsed;
  } catch {
    // ignore
  }
  return { kind: 'empty' };
}
