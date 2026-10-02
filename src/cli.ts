#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "./store.js";
import { runAnalysis, toCsv } from "./service.js";
import { bettiAt, representativeCycleAtBirth } from "./persistence.js";
import { validatePoints } from "./persistence.js";

function usage() {
  console.log(`用法:
  pcph import <name> <points.json> [--db data/app.sqlite]
  pcph analyze <cloudId> --max-epsilon <number> [--omit-zero] [--db ...]
  pcph list [--db ...]
  pcph analysis <analysisId> [--db ...]
  pcph barcodes <analysisId> [--db ...]
  pcph filtration <analysisId> [--db ...]
  pcph slice <analysisId> <epsilon> [--db ...]
  pcph cycle <analysisId> <p1,p2,...> [--db ...]
  pcph export <analysisId> <json|csv> [outputFile] [--db ...]
  pcph compare <leftAnalysisId> <rightAnalysisId> [--db ...]`);
}

function argsAfter(scriptArgs: string[]) {
  const dbIndex = scriptArgs.indexOf("--db");
  const dbPath = resolve(dbIndex >= 0 ? scriptArgs[dbIndex + 1]! : "data/pointcloud-ph.sqlite");
  const filtered = scriptArgs.filter((_, index) => index !== dbIndex && index !== dbIndex + 1);
  return { filtered, dbPath };
}

function readAnalysis(store: Store, id: number) {
  const stored = store.getAnalysis(id);
  if (!stored) throw new Error("分析不存在");
  return { stored, config: JSON.parse(stored.config_json), result: JSON.parse(stored.result_json) };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { filtered, dbPath } = argsAfter(rest);
  const store = new Store(dbPath);
  try {
    if (!command || command === "help") return usage();
    if (command === "import") {
      const [name, file] = filtered;
      const payload = JSON.parse(readFileSync(file!, "utf-8"));
      const points = Array.isArray(payload) ? payload : payload.points;
      const cloud = store.insertCloud(name!, validatePoints(points));
      console.log(JSON.stringify({ cloud, points: store.getPoints(cloud.id) }, null, 2));
      return;
    }
    if (command === "list") {
      console.log(JSON.stringify({ clouds: store.listClouds(), analyses: store.listAnalyses().map(({ result_json, config_json, ...item }) => item) }, null, 2));
      return;
    }
    if (command === "analyze") {
      const cloudId = Number(filtered[0]);
      const maxIndex = filtered.indexOf("--max-epsilon");
      const maxEpsilon = maxIndex >= 0 ? Number(filtered[maxIndex + 1]) : undefined;
      console.log(JSON.stringify(runAnalysis(store, cloudId, { maxEpsilon, includeZeroLength: !filtered.includes("--omit-zero") }), null, 2));
      return;
    }
    if (["analysis", "barcodes", "filtration"].includes(command)) {
      const { stored, config, result } = readAnalysis(store, Number(filtered[0]));
      if (command === "analysis") console.log(JSON.stringify({ id: stored.id, cloud_id: stored.cloud_id, version: stored.version, created_at: stored.created_at, config, result }, null, 2));
      if (command === "barcodes") console.log(JSON.stringify({ barcodes: result.barcodes, stats: result.stats }, null, 2));
      if (command === "filtration") console.log(JSON.stringify(result.simplices.map(({ index, dimension, filtration, pointIds }: never) => ({ index, dimension, filtration, pointIds })), null, 2));
      return;
    }
    if (command === "slice") {
      const result = readAnalysis(store, Number(filtered[0])).result;
      console.log(JSON.stringify(bettiAt(result, Number(filtered[1])), null, 2));
      return;
    }
    if (command === "cycle") {
      const result = readAnalysis(store, Number(filtered[0])).result;
      console.log(JSON.stringify(representativeCycleAtBirth(result, 1, filtered[1]!.split(",")), null, 2));
      return;
    }
    if (command === "export") {
      const [id, format, output] = filtered;
      const { stored, config, result } = readAnalysis(store, Number(id));
      const content = format === "csv" ? toCsv(result) : JSON.stringify({ config, result }, null, 2);
      if (output) writeFileSync(output, content, "utf-8");
      else process.stdout.write(content + "\n");
      console.error(`已导出分析 ${stored.id} 为 ${format}`);
      return;
    }
    if (command === "compare") {
      const left = readAnalysis(store, Number(filtered[0])).result;
      const right = readAnalysis(store, Number(filtered[1])).result;
      const signature = (barcodes: { dimension: number; birth: number; death: number | null }[]) => barcodes.map((b) => `${b.dimension}:${b.birth}:${b.death ?? "censored"}`).sort().join(";");
      console.log(JSON.stringify({ equal: signature(left.barcodes) === signature(right.barcodes) }, null, 2));
      return;
    }
    usage();
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
