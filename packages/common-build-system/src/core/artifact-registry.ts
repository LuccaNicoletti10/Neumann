import fs from "node:fs";
import path from "node:path";
import { SignedBuildManifest } from "../types";
import { StepLog } from "./virtualization-environment";

export interface BuildRecord {
  manifest: SignedBuildManifest;
  command: string;
  status: "success" | "failed";
  steps: StepLog[];
  packagePath: string;
  error?: string;
}

interface StoredRecord {
  manifest: SignedBuildManifest;
  command: string;
  status: "success" | "failed";
  steps: StepLog[];
  packageFile: string;
  error?: string;
}

export class ArtifactRegistry {
  constructor(readonly rootDir: string) {
    fs.mkdirSync(path.join(rootDir, "builds"), { recursive: true });
  }

  private buildsDir(): string {
    return path.join(this.rootDir, "builds");
  }

  save(
    record: Omit<BuildRecord, "packagePath">,
    packageData: Buffer,
    packageFileName: string
  ): BuildRecord {
    const dir = path.join(this.buildsDir(), record.manifest.buildId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify(record.manifest, null, 2),
      "utf8"
    );
    fs.writeFileSync(path.join(dir, packageFileName), packageData);
    const stored: StoredRecord = {
      manifest: record.manifest,
      command: record.command,
      status: record.status,
      steps: record.steps,
      packageFile: packageFileName,
      error: record.error,
    };
    fs.writeFileSync(path.join(dir, "record.json"), JSON.stringify(stored, null, 2), "utf8");
    return { ...record, packagePath: path.join(dir, packageFileName) };
  }

  get(buildId: string): BuildRecord | undefined {
    const dir = path.join(this.buildsDir(), buildId);
    const recordPath = path.join(dir, "record.json");
    if (!fs.existsSync(recordPath)) return undefined;
    const stored = JSON.parse(fs.readFileSync(recordPath, "utf8")) as StoredRecord;
    return { ...stored, packagePath: path.join(dir, stored.packageFile) };
  }

  list(): BuildRecord[] {
    const dir = this.buildsDir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((id) => this.get(id))
      .filter((r): r is BuildRecord => r !== undefined)
      .sort((a, b) => (a.manifest.createdAt < b.manifest.createdAt ? 1 : -1));
  }

  latestFor(product: string): BuildRecord | undefined {
    return this.list().find(
      (r) => r.manifest.product === product && r.status === "success"
    );
  }
}
