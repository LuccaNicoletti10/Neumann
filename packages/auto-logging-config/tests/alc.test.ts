import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CentralLogRepository } from "../src/core/central-repository";
import { Datastore } from "../src/core/datastore";
import { LogEntryComponent } from "../src/core/log-entry-component";
import { jaccardSimilarity, ReducerModule } from "../src/core/reducer-module";
import { SearchPatternGenerator } from "../src/core/search-pattern-generator";
import {
  buildSearchPattern,
  OrderedPatternList,
  tokenizeFormatString,
} from "../src/core/search-pattern-module";
import { SourceCodeRepository, scanSource } from "../src/core/source-code-module";
import { createContext, buildServer } from "../src/server";

const sampleRepo = path.join(__dirname, "..", "examples", "sample-repo");
const sampleLog = path.join(__dirname, "..", "examples", "sample-output.log");

describe("SourceCodeModule", () => {
  it("escaneia sample-repo e encontra logging calls", () => {
    const calls = new SourceCodeRepository(sampleRepo).scan();
    expect(calls.length).toBeGreaterThanOrEqual(6);
    expect(calls.some((c) => c.formatString.includes("logged in"))).toBe(true);
    expect(calls.some((c) => c.formatString.includes("hello"))).toBe(true);
  });

  it("extractArguments respeita strings e aninhamento", () => {
    const content = `console.log("a,b", foo(1,2));`;
    const calls = scanSource("x.js", content);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.argCount).toBe(2);
    expect(calls[0]!.formatString).toBe("a,b");
  });
});

describe("SearchPatternModule", () => {
  it("tokeniza printf e {} e ${}", () => {
    expect(tokenizeFormatString("user %s code %d").map((t) => t.kind)).toEqual([
      "static",
      "param",
      "static",
      "param",
    ]);
    expect(tokenizeFormatString("job {} done").filter((t) => t.kind === "param")).toHaveLength(1);
    expect(tokenizeFormatString("x ${jobId} y").some((t) => t.name === "jobId")).toBe(true);
  });

  it("buildSearchPattern casa mensagem correspondente", () => {
    const pattern = buildSearchPattern(
      {
        file: "a.go",
        line: 1,
        function: "handleRequest",
        formatString: "user %s logged in with code %d",
        argCount: 3,
      },
      "p0"
    );
    const list = new OrderedPatternList();
    list.add(pattern);
    const hit = list.match("user alice logged in with code 200");
    expect(hit).not.toBeNull();
    expect(hit!.params.p0).toBe("alice");
    expect(hit!.params.p1).toBe("200");
  });
});

describe("ReducerModule", () => {
  it("aplica threshold e mergeSimilar", () => {
    const reducer = new ReducerModule();
    const patterns = [
      buildSearchPattern(
        { file: "a", line: 1, function: "f", formatString: "hello, %s!", argCount: 2 },
        "a"
      ),
      buildSearchPattern(
        { file: "b", line: 1, function: "f", formatString: "hello, %s!!", argCount: 2 },
        "b"
      ),
      buildSearchPattern(
        { file: "c", line: 1, function: "f", formatString: "other %d", argCount: 2 },
        "c"
      ),
    ];
    patterns[0]!.matchCount = 10;
    patterns[1]!.matchCount = 5;
    expect(jaccardSimilarity(patterns[0]!, patterns[1]!)).toBeGreaterThan(0.5);
    const removed = reducer.applyThreshold(patterns, 2);
    expect(removed).toContain("c");
    expect(patterns).toHaveLength(2);
    const merged = reducer.mergeSimilar(patterns, 0.5);
    expect(merged.length + patterns.length).toBeGreaterThan(0);
  });
});

describe("pipeline generate + ingest", () => {
  it("sample-output.log → 8 matched / 2 dropped", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "alc-"));
    const datastore = new Datastore(path.join(tmp, "datastore.json"));
    const generator = new SearchPatternGenerator(datastore);
    // similarity alto o bastante para nao colapsar padroes distintos do sample
    const result = generator.generateConfig(sampleRepo, {
      threshold: 100,
      similarityThreshold: 0.95,
    });
    expect(result.patterns.length).toBeGreaterThan(0);

    const repository = new CentralLogRepository();
    const daemon = new LogEntryComponent(repository);
    generator.configure(daemon);

    const lines = fs
      .readFileSync(sampleLog, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const results = lines.map((m) => daemon.ingest(m));
    const matched = results.filter((r) => r.status === "matched").length;
    const dropped = results.filter((r) => r.status === "dropped").length;
    expect(matched).toBe(8);
    expect(dropped).toBe(2);
    expect(daemon.stats().totalReceived).toBe(10);
  });
});

describe("API HTTP", () => {
  it("generate + ingest via endpoints", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "alc-api-"));
    const ctx = createContext(path.join(tmp, "datastore.json"));
    const app = buildServer(ctx);
    await app.ready();

    const gen = await app.inject({
      method: "POST",
      url: "/patterns/generate",
      payload: { repoDir: sampleRepo, similarityThreshold: 0.95 },
    });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().patterns.length).toBeGreaterThan(0);

    const ingest = await app.inject({
      method: "POST",
      url: "/logs/ingest",
      payload: {
        messages: [
          "user alice logged in with code 200",
          "this line matches no known logging pattern",
        ],
      },
    });
    expect(ingest.statusCode).toBe(200);
    expect(ingest.json().matched).toBe(1);
    expect(ingest.json().dropped).toBe(1);

    await app.close();
  });
});
