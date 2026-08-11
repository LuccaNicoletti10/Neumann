/**
 * contracts — src/v1/dataset-store.ts
 * DatasetStore congelado (Passo 8). policyId e lineageRef reservados (nullable).
 */

/** Identificadores opacos. */
export type DatasetId = string;
export type VersionId = string;

/** Definição para criar um dataset. */
export interface DatasetDef {
  name: string;
  description?: string;
}

/** Dataset (cabeçalho); versões vivem em DatasetVersion. */
export interface Dataset {
  id: DatasetId;
  name: string;
  description?: string;
  createdAt: string;
  /** Id da última versão commitada, se houver. */
  latestVersionId?: VersionId;
}

/** Entrada de commit — shape congelado desde Passo 8. */
export interface CommitInput {
  parentVersion?: VersionId;
  inputVersions: VersionId[];
  transformationId?: string;
  schemaVersion: string;
  contentRef: string;
  contentHash: string;
  /** Reservado (nullable) — preenchido em marcos posteriores. */
  policyId: string | null;
  /** Reservado (nullable) — preenchido em marcos posteriores. */
  lineageRef: string | null;
  /** Quem commitou (principal). */
  createdBy?: string;
  /** Payload lógico opcional (para diff em memória). */
  payload?: Record<string, unknown> | unknown[];
}

/** Versão commitada: imutável após criação. */
export interface DatasetVersion {
  id: VersionId;
  datasetId: DatasetId;
  /** Número monotônico 1..N por dataset. */
  versionNumber: number;
  parentVersion?: VersionId;
  inputVersions: VersionId[];
  transformationId?: string;
  schemaVersion: string;
  contentRef: string;
  contentHash: string;
  policyId: string | null;
  lineageRef: string | null;
  createdAt: string;
  createdBy: string;
  status: 'COMMITTED';
}

/** Diff mínimo entre duas versões (Passo 8). */
export interface VersionDiff {
  a: VersionId;
  b: VersionId;
  sameContent: boolean;
  contentHashA: string;
  contentHashB: string;
  addedKeys: string[];
  removedKeys: string[];
  changedKeys: string[];
}

/** Contrato DatasetStore (Passo 8 — sem time-travel completo). */
export interface DatasetStore {
  createDataset(def: DatasetDef): Promise<Dataset> | Dataset;
  commitVersion(datasetId: DatasetId, input: CommitInput): Promise<DatasetVersion> | DatasetVersion;
  getLatestVersion(datasetId: DatasetId): Promise<DatasetVersion | undefined> | DatasetVersion | undefined;
  getVersion(versionId: VersionId): Promise<DatasetVersion | undefined> | DatasetVersion | undefined;
  listVersions(datasetId: DatasetId): Promise<DatasetVersion[]> | DatasetVersion[];
  diff(a: VersionId, b: VersionId): Promise<VersionDiff> | VersionDiff;
}

/** Valida CommitInput (shape leve). */
export function assertCommitInput(value: unknown): asserts value is CommitInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CommitInput: esperado objeto');
  }
  const c = value as Record<string, unknown>;
  if (!Array.isArray(c.inputVersions) || !c.inputVersions.every((v) => typeof v === 'string')) {
    throw new Error('CommitInput: inputVersions deve ser string[]');
  }
  for (const key of ['schemaVersion', 'contentRef', 'contentHash'] as const) {
    if (typeof c[key] !== 'string' || (c[key] as string).length === 0) {
      throw new Error(`CommitInput: ${key} deve ser string não vazia`);
    }
  }
  if (!('policyId' in c)) throw new Error('CommitInput: campo ausente: policyId');
  if (!('lineageRef' in c)) throw new Error('CommitInput: campo ausente: lineageRef');
  if (c.policyId !== null && typeof c.policyId !== 'string') {
    throw new Error('CommitInput: policyId deve ser string | null');
  }
  if (c.lineageRef !== null && typeof c.lineageRef !== 'string') {
    throw new Error('CommitInput: lineageRef deve ser string | null');
  }
}

/** Fixture dourada de CommitInput (shape congelado). */
export function buildGoldenCommitInput(): CommitInput {
  return {
    parentVersion: undefined,
    inputVersions: [],
    transformationId: undefined,
    schemaVersion: '1',
    contentRef: 'sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    policyId: null,
    lineageRef: null,
    createdBy: 'system',
    payload: { rows: [{ id: 1, name: 'Ada' }] },
  };
}
