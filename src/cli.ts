#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "./core/store.ts";
import { bettiAt, representativeCycle } from "./core/persistence.ts";
import { bruteBetti, compareResults, mstMergeScales } from "./core/crosscheck.ts";
import { barsToCsv, filtrationToCsv } from "./core/exporters.ts";
import type { Point } from "./core/types.ts";

function usage(): never {
  console.error(`用法: node --experimental-strip-types src/cli.ts <命令> [参数]

命令:
  init-db
  import <版本名> <points.json>
  versions
  analyze <版本名> --scale <数> [--keep-zero] [--max-points N] [--max-simplices N]
  analyses [版本名]
  result <分析ID>
  filtration <分析ID> [--csv]
  barcodes <分析ID> [--csv]
  slice <分析ID> --scale <数>
  cycle <分析ID> --birth <出生单纯形序号>
  crosscheck <分析ID>
  compare <分析ID A> <分析ID B>
  export <分析ID> --kind bars|filtration|json [--out 文件]

环境:
  PCDATA_DIR  数据目录(默认 ./data)

points.json: { "points": [{"id":"p0","coord":[0,0]}, ...] }`);
  process.exit(1);
}

function parseFlags(args: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    }
  }
  return flags;
}

function flagNum(flags: Map<string, string | boolean>, key: string): number | undefined {
  const v = flags.get(key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} 必须是数值`);
  return n;
}

function loadPoints(file: string): Point[] {
  const data = JSON.parse(readFileSync(file, "utf8")) as { points?: Point[] };
  if (!Array.isArray(data.points)) throw new Error("JSON 需要 points 数组");
  return data.points;
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();
  const dataDir = resolve(process.env.PCDATA_DIR ?? "data");
  const store = new Store(resolve(dataDir, "ph.sqlite"));
  const out = (x: unknown): void => console.log(JSON.stringify(x, null, 2));

  switch (cmd) {
    case "init-db":
      out({ ok: true, dataDir });
      break;
    case "import": {
      const [name, file] = rest;
      if (!name || !file) usage();
      out(store.importVersion(name, loadPoints(file)));
      break;
    }
    case "versions":
      out(store.listVersions());
      break;
    case "analyze": {
      const [name] = rest;
      const flags = parseFlags(rest.slice(1));
      const scale = flagNum(flags, "scale");
      if (!name || scale === undefined) usage();
      const limits: Record<string, number> = {};
      const mp = flagNum(flags, "max-points");
      const ms = flagNum(flags, "max-simplices");
      if (mp !== undefined) limits.maxPoints = mp;
      if (ms !== undefined) limits.maxSimplices = ms;
      const { analysis, result } = store.runAnalysis(name, scale, {
        keepZeroLength: flags.get("keep-zero") === true,
        limits: Object.keys(limits).length ? (limits as never) : undefined,
      });
      out({ analysis, summary: summarize(result) });
      break;
    }
    case "analyses":
      out(store.listAnalyses(rest[0]));
      break;
    case "result": {
      const id = Number(rest[0]);
      out(store.getResult(id));
      break;
    }
    case "filtration": {
      const id = Number(rest[0]);
      const flags = parseFlags(rest.slice(1));
      const result = store.getResult(id);
      if (flags.get("csv") === true) process.stdout.write(filtrationToCsv(result));
      else out(result.simplices.map((s, i) => ({ index: i, dim: s.dim, filt: s.filt, verts: s.verts.map((v) => result.pointIds[v]) })));
      break;
    }
    case "barcodes": {
      const id = Number(rest[0]);
      const flags = parseFlags(rest.slice(1));
      const result = store.getResult(id);
      if (flags.get("csv") === true) process.stdout.write(barsToCsv(result));
      else out({ bars: result.bars, summary: summarize(result) });
      break;
    }
    case "slice": {
      const id = Number(rest[0]);
      const flags = parseFlags(rest.slice(1));
      const scale = flagNum(flags, "scale");
      if (scale === undefined) usage();
      const result = store.getResult(id);
      const fromBars = bettiAt(result, scale);
      const points = store.getPoints(result.versionName);
      out({ scale, ...fromBars, bruteRankCheck: result.simplices.length <= 5000 ? bruteBetti(points, scale) : null });
      break;
    }
    case "cycle": {
      const id = Number(rest[0]);
      const flags = parseFlags(rest.slice(1));
      const birth = flagNum(flags, "birth");
      if (birth === undefined) usage();
      const cycle = representativeCycle(store.getResult(id), birth);
      if (!cycle) throw new Error("该出生单纯形没有 H1 代表环");
      out(cycle);
      break;
    }
    case "crosscheck": {
      const id = Number(rest[0]);
      const result = store.getResult(id);
      const points = store.getPoints(result.versionName);
      const mst = mstMergeScales(points, store.getAnalysis(id)!.maxScale);
      const h0 = result.bars.filter((b) => b.dim === 0 && !b.censored).map((b) => b.death);
      out({ mst, h0Deaths: h0 });
      break;
    }
    case "compare": {
      const [a, b] = [Number(rest[0]), Number(rest[1])];
      if (!Number.isInteger(a) || !Number.isInteger(b)) usage();
      out(compareResults(store.getResult(a), store.getResult(b)));
      break;
    }
    case "export": {
      const id = Number(rest[0]);
      const flags = parseFlags(rest.slice(1));
      const result = store.getResult(id);
      const kind = String(flags.get("kind") ?? "bars");
      const payload =
        kind === "filtration"
          ? filtrationToCsv(result)
          : kind === "json"
            ? JSON.stringify(result, null, 2)
            : barsToCsv(result);
      const file = flags.get("out");
      if (typeof file === "string") {
        writeFileSync(file, payload);
        out({ exported: file, bytes: payload.length });
      } else {
        process.stdout.write(payload + "\n");
      }
      break;
    }
    default:
      usage();
  }
  store.close();
}

function summarize(result: Awaited<ReturnType<Store["getResult"]>>): unknown {
  return {
    pointCount: result.pointCount,
    simplexCount: result.simplexCount,
    columnAdditions: result.columnAdditions,
    limits: result.limits,
    aborted: result.aborted,
    abortReason: result.abortReason,
    h0Bars: result.bars.filter((b) => b.dim === 0).length,
    h1Bars: result.bars.filter((b) => b.dim === 1).length,
  };
}

main();
