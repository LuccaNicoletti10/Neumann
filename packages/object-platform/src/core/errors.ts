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

/** Same sourceEventId, different payload. No extra effects. */
export class ProjectionConflictError extends Error {
  readonly code = 'PROJECTION_CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ProjectionConflictError';
  }
}

/** Policy deny. Message must not reveal whether the target exists. */
export class ProjectionDeniedError extends Error {
  readonly code = 'PROJECTION_DENIED' as const;
  constructor() {
    super('projection denied');
    this.name = 'ProjectionDeniedError';
  }
}

export class LinkIntegrityError extends Error {
  readonly code = 'VALIDATION_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LinkIntegrityError';
  }
}

/** Write rejected by the OntologyVersion that governs it. */
export class OntologyValidationError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(`ontology validation failed: ${violations.join('; ')}`);
    this.name = 'OntologyValidationError';
    this.violations = violations;
  }
}

/**
 * The version governing the object cannot satisfy the version the caller asked
 * for. Names both versions so a v2 Action on a v1 object fails explicitly.
 */
export class OntologyVersionMismatchError extends OntologyValidationError {
  readonly objectVersionId: string | undefined;
  readonly requestedVersionId: string | undefined;

  constructor(input: {
    objectVersionId?: string;
    requestedVersionId?: string;
    incompatibility: string[];
  }) {
    super([
      `object is on ontology version ${input.objectVersionId ?? '(unstamped)'}, ` +
        `operation requested ${input.requestedVersionId ?? '(latest)'}: ` +
        input.incompatibility.join('; '),
    ]);
    this.name = 'OntologyVersionMismatchError';
    this.objectVersionId = input.objectVersionId;
    this.requestedVersionId = input.requestedVersionId;
  }
}
