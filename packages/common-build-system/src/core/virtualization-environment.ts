import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BuildManifest, TranslatedStep } from "../types";
import { loadManifest } from "../util/manifest";

export interface StepLog {
  step: string;
  cmd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class BuildStepError extends Error {
  constructor(public readonly log: StepLog) {
    super(
      `Passo '${log.step}' falhou com exit code ${log.exitCode}: ${log.cmd}\n${log.stderr.trim()}`
    );
    this.name = "BuildStepError";
  }
}

export class VirtualizationEnvironment {
  private constructor(
    readonly workDir: string,
    readonly productDir: string,
    readonly manifest: BuildManifest
  ) {}

  static create(productDir: string): VirtualizationEnvironment {
    const manifest = loadManifest(productDir);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `cbs-${manifest.name}-`));
    fs.cpSync(productDir, workDir, { recursive: true });
    return new VirtualizationEnvironment(workDir, productDir, manifest);
  }

  async runSteps(steps: TranslatedStep[]): Promise<StepLog[]> {
    const logs: StepLog[] = [];
    for (const step of steps) {
      const log = await this.runStep(step);
      logs.push(log);
      if (log.exitCode !== 0) throw new BuildStepError(log);
    }
    return logs;
  }

  private runStep(step: TranslatedStep): Promise<StepLog> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn("/bin/sh", ["-c", step.cmd], {
        cwd: this.workDir,
        env: {
          ...process.env,
          CBS_PRODUCT_NAME: this.manifest.name,
          CBS_PRODUCT_VERSION: this.manifest.version,
          CBS_WORKDIR: this.workDir,
          npm_config_cache: path.join(this.workDir, ".npm-cache"),
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          step: step.name,
          cmd: step.cmd,
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  cleanup(): void {
    fs.rmSync(this.workDir, { recursive: true, force: true });
  }
}
