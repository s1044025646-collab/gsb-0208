import { createServer, type IncomingMessage, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../core/store.ts";
import { bettiAt, representativeCycle } from "../core/persistence.ts";
import { bruteBetti, compareResults, mstMergeScales } from "../core/crosscheck.ts";
import { barsToCsv, filtrationToCsv } from "../core/exporters.ts";
import type { Point } from "../core/types.ts";

export interface AppConfig {
  dataDir: string;
  port: number;
}

export function readConfig(): AppConfig {
  const dataDir = resolve(process.env.PCDATA_DIR ?? "data");
  const port = Number(process.env.PCPORT ?? process.env.PORT ?? 8787);
  return { dataDir, port };
}

interface HandlerArg {
  store: Store;
  body: unknown;
  query: URLSearchParams;
}

export function createApp(store: Store): Server {
  return createServer(async (req, res) => {
    try {
      await route(req, res, store);
    } catch (err) {
      send(res, 400, { error: (err as Error).message });
    }
  });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

async function route(req: IncomingMessage, res: import("node:http").ServerResponse, store: Store): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const body = await readBody(req);
  const arg: HandlerArg = { store, body, query: url.searchParams };

  if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });
  if (req.method === "GET" && path === "/versions") return send(res, 200, { versions: store.listVersions() });
  if (req.method === "POST" && path === "/versions") return importVersion(arg, res);
  if (req.method === "GET" && path.startsWith("/versions/") && path.endsWith("/points")) {
    const name = decodeURIComponent(path.split("/")[2]!);
    return send(res, 200, { points: store.getPoints(name) });
  }
  if (req.method === "POST" && path.startsWith("/versions/") && path.endsWith("/analyses")) {
    const name = decodeURIComponent(path.split("/")[2]!);
    return runAnalysis(name, arg, res);
  }
  if (req.method === "GET" && path === "/analyses") {
    return send(res, 200, { analyses: store.listAnalyses(arg.query.get("version") ?? undefined) });
  }
  if (req.method === "GET" && /^\/analyses\/\d+$/.test(path)) {
    const id = Number(path.split("/")[2]);
    return send(res, 200, { analysis: store.getAnalysis(id), result: store.getResult(id) });
  }
  if (req.method === "GET" && /^\/analyses\/\d+\/filtration$/.test(path)) {
    const id = Number(path.split("/")[2]);
    const result = store.getResult(id);
    if (arg.query.get("format") === "csv") return sendCsv(res, filtrationToCsv(result));
    return send(res, 200, {
      simplices: result.simplices.map((s, i) => ({
        index: i,
        dim: s.dim,
        filt: s.filt,
        verts: s.verts.map((v) => result.pointIds[v]),
      })),
    });
  }
  if (req.method === "GET" && /^\/analyses\/\d+\/barcodes$/.test(path)) {
    const id = Number(path.split("/")[2]);
    const result = store.getResult(id);
    if (arg.query.get("format") === "csv") return sendCsv(res, barsToCsv(result));
    return send(res, 200, {
      bars: result.bars,
      meta: {
        pointCount: result.pointCount,
        simplexCount: result.simplexCount,
        columnAdditions: result.columnAdditions,
        limits: result.limits,
        aborted: result.aborted,
      },
    });
  }
  if (req.method === "GET" && /^\/analyses\/\d+\/slice$/.test(path)) {
    const id = Number(path.split("/")[2]);
    const scale = Number(arg.query.get("scale"));
    if (!Number.isFinite(scale)) throw new Error("需要数值型 scale 查询参数");
    const result = store.getResult(id);
    const fromBars = bettiAt(result, scale);
    const points = store.getPoints(result.versionName);
    const brute = result.simplices.length <= 5000 ? bruteBetti(points, scale) : null;
    return send(res, 200, { scale, ...fromBars, bruteRankCheck: brute });
  }
  if (req.method === "GET" && /^\/analyses\/\d+\/cycles\/\d+$/.test(path)) {
    const parts = path.split("/");
    const id = Number(parts[2]);
    const birthSimplex = Number(parts[4]);
    const result = store.getResult(id);
    const cycle = representativeCycle(result, birthSimplex);
    if (!cycle) throw new Error("该出生单纯形没有 H1 代表环");
    return send(res, 200, { cycle });
  }
  if (req.method === "GET" && /^\/analyses\/\d+\/crosscheck$/.test(path)) {
    const id = Number(path.split("/")[2]);
    const result = store.getResult(id);
    const points = store.getPoints(result.versionName);
    const analysis = store.getAnalysis(id)!;
    const mst = mstMergeScales(points, analysis.maxScale);
    const h0Deaths = result.bars.filter((b) => b.dim === 0 && !b.censored).map((b) => b.death!);
    const sortedMst = [...mst.merges].sort((a, b) => a - b);
    const sortedH0 = [...h0Deaths].sort((a, b) => a - b);
    const agree =
      sortedMst.length === sortedH0.length &&
      sortedMst.every((v, i) => Math.abs(v - sortedH0[i]!) < 1e-9);
    return send(res, 200, { mst, h0Deaths, mstAgreesWithH0: agree });
  }
  if (req.method === "POST" && path === "/compare") {
    const b = body as { a: number; b: number };
    const ra = store.getResult(b.a);
    const rb = store.getResult(b.b);
    return send(res, 200, { comparison: compareResults(ra, rb) });
  }
  if (req.method === "GET" && /^\/analyses\/\d+\/export$/.test(path)) {
    const id = Number(path.split("/")[2]);
    const result = store.getResult(id);
    const kind = arg.query.get("kind") ?? "bars";
    if (kind === "filtration") return sendCsv(res, filtrationToCsv(result), "filtration.csv");
    if (arg.query.get("format") === "json") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result, null, 2));
      return;
    }
    return sendCsv(res, barsToCsv(result), "barcodes.csv");
  }
  return send(res, 404, { error: "未找到路由", path });
}

function importVersion(arg: HandlerArg, res: import("node:http").ServerResponse): void {
  const b = arg.body as { name?: string; points?: Point[] };
  if (!b?.name || !Array.isArray(b.points)) throw new Error("需要 name 与 points 数组");
  const version = arg.store.importVersion(b.name, b.points);
  send(res, 201, { version });
}

function runAnalysis(
  name: string,
  arg: HandlerArg,
  res: import("node:http").ServerResponse,
): void {
  const b = arg.body as { maxScale?: number; keepZeroLength?: boolean; limits?: Record<string, number> };
  if (typeof b?.maxScale !== "number") throw new Error("需要数值型 maxScale");
  const { analysis, result } = arg.store.runAnalysis(name, b.maxScale, {
    keepZeroLength: b.keepZeroLength,
    limits: b.limits as never,
  });
  send(res, 201, { analysis, result });
}

function send(res: import("node:http").ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendCsv(res: import("node:http").ServerResponse, csv: string, filename = "export.csv"): void {
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end("\uFEFF" + csv);
}

const isMain = (() => {
  try {
    return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const cfg = readConfig();
  const store = new Store(resolve(cfg.dataDir, "ph.sqlite"));
  const server = createApp(store);
  server.listen(cfg.port, () => {
    console.log(`点云持久同调后端已启动: http://localhost:${cfg.port}`);
    console.log(`数据目录: ${cfg.dataDir}`);
  });
}
