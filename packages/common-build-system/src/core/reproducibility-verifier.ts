import { BuildPipeline } from "./build-pipeline";
import { BuildRecord } from "./artifact-registry";

export interface ReproducibilityReport {
  product: string;
  reproducible: boolean;
  artifactHash: string;
  runs: Array<{ buildId: string; artifactHash: string }>;
}

export class ReproducibilityVerifier {
  constructor(private readonly pipeline: BuildPipeline) {}

  async verify(productName: string): Promise<ReproducibilityReport> {
    const run1: BuildRecord = await this.pipeline.run(productName, "verify");
    const run2: BuildRecord = await this.pipeline.run(productName, "verify");
    const h1 = run1.manifest.artifactHash;
    const h2 = run2.manifest.artifactHash;
    return {
      product: productName,
      reproducible: h1 === h2,
      artifactHash: h1,
      runs: [
        { buildId: run1.manifest.buildId, artifactHash: h1 },
        { buildId: run2.manifest.buildId, artifactHash: h2 },
      ],
    };
  }
}
