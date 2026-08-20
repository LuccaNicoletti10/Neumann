/**
 * object-platform — src/core/ontology-compatibility.ts
 *
 * Deterministic classification of an OntologyVersion change.
 *
 * WHY: "can objects move from A to B?" must be answered by the diff of the two
 * versions, never by whoever is publishing. A breaking change is never migrated
 * automatically; it requires a declared transformation per object.
 */

import type {
  LinkTypeDef,
  ObjectTypeDef,
  OntologyVersion,
  PropertyTypeDef,
  PropertyValidator,
} from 'contracts';

export type CompatibilityClass =
  /** Old objects remain valid unchanged. */
  | 'additive-compatible'
  /** Old values have a declared lossless transformation into the new type. */
  | 'coercible'
  /** Old objects can be invalid; migration needs an explicit transformation. */
  | 'breaking'
  /** The pair cannot be compared: different ontology, or a malformed version. */
  | 'invalid';

export interface CompatibilityFinding {
  class: CompatibilityClass;
  objectTypeId?: string;
  propertyTypeId?: string;
  linkTypeId?: string;
  reason: string;
}

export interface OntologyCompatibility {
  /** Worst finding. No findings = additive-compatible. */
  class: CompatibilityClass;
  findings: CompatibilityFinding[];
}

/**
 * Declared lossless widenings. WHY these and not "any numeric change": the
 * stored JSON scalar has a total textual representation, so a transformation
 * exists in this direction and not in the reverse one.
 */
const COERCIBLE_BASE_TYPES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['number', new Set(['string'])],
  ['datetime', new Set(['string'])],
  ['boolean', new Set(['string'])],
  ['object_ref', new Set(['string'])],
]);

const SEVERITY: Record<CompatibilityClass, number> = {
  'additive-compatible': 0,
  coercible: 1,
  breaking: 2,
  invalid: 3,
};

function isRequired(def: PropertyTypeDef | undefined): boolean {
  return def?.validators?.some((v) => v.kind === 'required') === true;
}

function setValues(def: PropertyTypeDef | undefined): string[] | undefined {
  const validator = def?.validators?.find(
    (v): v is Extract<PropertyValidator, { kind: 'set' }> => v.kind === 'set',
  );
  return validator?.values;
}

function patternOf(def: PropertyTypeDef | undefined): string | undefined {
  const validator = def?.validators?.find(
    (v): v is Extract<PropertyValidator, { kind: 'regex' }> => v.kind === 'regex',
  );
  return validator?.pattern;
}

function malformed(version: OntologyVersion): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];
  for (const objectType of Object.values(version.objectTypes) as ObjectTypeDef[]) {
    for (const propertyTypeId of objectType.propertyTypeIds) {
      if (!version.propertyTypes[propertyTypeId]) {
        findings.push({
          class: 'invalid',
          objectTypeId: objectType.id,
          propertyTypeId,
          reason: `version ${version.id} declares property "${propertyTypeId}" on "${objectType.id}" but has no PropertyType for it`,
        });
      }
    }
  }
  return findings;
}

function classifyProperty(
  objectTypeId: string,
  propertyTypeId: string,
  before: PropertyTypeDef,
  after: PropertyTypeDef,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];
  const at = { objectTypeId, propertyTypeId };

  if (before.baseType !== after.baseType) {
    const widening = COERCIBLE_BASE_TYPES.get(before.baseType);
    findings.push({
      ...at,
      class: widening?.has(after.baseType) ? 'coercible' : 'breaking',
      reason: `baseType "${before.baseType}" → "${after.baseType}"`,
    });
  }

  if (!isRequired(before) && isRequired(after)) {
    findings.push({
      ...at,
      class: 'breaking',
      reason: 'optional property became required; existing objects may have no value',
    });
  }

  const beforeSet = setValues(before);
  const afterSet = setValues(after);
  if (beforeSet && afterSet) {
    const removed = beforeSet.filter((v) => !afterSet.includes(v));
    if (removed.length > 0) {
      findings.push({
        ...at,
        class: 'breaking',
        reason: `allowed values removed: ${removed.join(', ')}`,
      });
    }
  } else if (!beforeSet && afterSet) {
    findings.push({
      ...at,
      class: 'breaking',
      reason: 'new value set constrains existing values',
    });
  }

  const beforePattern = patternOf(before);
  const afterPattern = patternOf(after);
  if (afterPattern !== undefined && afterPattern !== beforePattern) {
    findings.push({
      ...at,
      class: 'breaking',
      reason: `regex constraint changed to /${afterPattern}/`,
    });
  }

  return findings;
}

function classifyLinkTypes(
  from: OntologyVersion,
  to: OntologyVersion,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];
  for (const [linkTypeId, before] of Object.entries(from.linkTypes) as [string, LinkTypeDef][]) {
    const after = to.linkTypes[linkTypeId];
    if (!after) {
      findings.push({
        class: 'breaking',
        linkTypeId,
        reason: 'link type removed',
      });
      continue;
    }
    if (
      before.sourceObjectTypeId !== after.sourceObjectTypeId ||
      before.targetObjectTypeId !== after.targetObjectTypeId
    ) {
      findings.push({
        class: 'breaking',
        linkTypeId,
        reason: 'link endpoints changed',
      });
    }
    if (before.cardinality !== after.cardinality) {
      findings.push({
        class: 'breaking',
        linkTypeId,
        reason: `cardinality "${before.cardinality ?? 'unset'}" → "${after.cardinality ?? 'unset'}"`,
      });
    }
  }
  for (const linkTypeId of Object.keys(to.linkTypes)) {
    if (!from.linkTypes[linkTypeId]) {
      findings.push({
        class: 'additive-compatible',
        linkTypeId,
        reason: 'link type added',
      });
    }
  }
  return findings;
}

/**
 * Classify the change from `from` to `to`. Pure and order-independent: the same
 * pair always yields the same class and the same findings.
 */
export function classifyOntologyChange(
  from: OntologyVersion,
  to: OntologyVersion,
): OntologyCompatibility {
  if (from.ontologyId !== to.ontologyId) {
    return {
      class: 'invalid',
      findings: [
        {
          class: 'invalid',
          reason: `versions belong to different ontologies: "${from.ontologyId}" and "${to.ontologyId}"`,
        },
      ],
    };
  }

  const findings: CompatibilityFinding[] = [...malformed(from), ...malformed(to)];

  for (const [objectTypeId, before] of Object.entries(from.objectTypes) as [
    string,
    ObjectTypeDef,
  ][]) {
    const after = to.objectTypes[objectTypeId];
    if (!after) {
      findings.push({
        class: 'breaking',
        objectTypeId,
        reason: 'object type removed',
      });
      continue;
    }
    const afterProperties = new Set(after.propertyTypeIds);
    for (const propertyTypeId of before.propertyTypeIds) {
      if (!afterProperties.has(propertyTypeId)) {
        findings.push({
          class: 'breaking',
          objectTypeId,
          propertyTypeId,
          reason: 'property removed from object type',
        });
        continue;
      }
      const beforeDef = from.propertyTypes[propertyTypeId];
      const afterDef = to.propertyTypes[propertyTypeId];
      if (!beforeDef || !afterDef) continue; // already reported by malformed()
      findings.push(...classifyProperty(objectTypeId, propertyTypeId, beforeDef, afterDef));
    }
    const beforeProperties = new Set(before.propertyTypeIds);
    for (const propertyTypeId of after.propertyTypeIds) {
      if (beforeProperties.has(propertyTypeId)) continue;
      const afterDef = to.propertyTypes[propertyTypeId];
      if (!afterDef) continue;
      // WHY breaking: the model has no property defaults, so a new required
      // property cannot be satisfied by an object written before it existed.
      findings.push({
        class: isRequired(afterDef) ? 'breaking' : 'additive-compatible',
        objectTypeId,
        propertyTypeId,
        reason: isRequired(afterDef)
          ? 'new required property has no default'
          : 'new optional property',
      });
    }
  }

  for (const objectTypeId of Object.keys(to.objectTypes)) {
    if (!from.objectTypes[objectTypeId]) {
      findings.push({
        class: 'additive-compatible',
        objectTypeId,
        reason: 'object type added',
      });
    }
  }

  findings.push(...classifyLinkTypes(from, to));

  let worst: CompatibilityClass = 'additive-compatible';
  for (const finding of findings) {
    if (SEVERITY[finding.class] > SEVERITY[worst]) worst = finding.class;
  }
  return { class: worst, findings };
}
