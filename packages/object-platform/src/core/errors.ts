/**
 * object-platform — src/core/errors.ts
 */

export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT' as const;
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export class ObjectNotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ObjectNotFoundError';
  }
}

export class DuplicateObjectError extends Error {
  readonly code = 'CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateObjectError';
  }
}

export class LinkIntegrityError extends Error {
  readonly code = 'VALIDATION_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LinkIntegrityError';
  }
}
