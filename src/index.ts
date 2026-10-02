import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Store } from "./store.js";
import { bettiAt, representativeCycleAtBirth, runAnalysis, toCsv } from "./service.js";
import { computePersistence, validatePoints } from "./persistence.js";
import { bettiByRanks, compareBarcodes, mstMergeScales } from "./verification.js";

type Json = Record<string, unknown>;

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

async function readJson(request: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

export function createApp(dbPath = resolve("data/pointcloud-ph.sqlite")) {
  const store = new Store(dbPath);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = request.method ?? "GET";

      if (method === "GET" && path === "/health") return send(response, 200, { ok: true, engine: "built-in GF(2) column reduction" });

      if (method === "POST" && path === "/clouds") {
        const body = await readJson(request);
        const name = String(body.name ?? "default");
        const points = body.points;
        if (!Array.isArray(points)) throw new Error("points 必须是数组");
        const cloud = store.insertCloud(name, validatePoints(points as never));
        return send(response, 201, { cloud, points: store.getPoints(cloud.id) });
      }

      if (method === "GET" && path === "/clouds") return send(response, 200, { clouds: store.listClouds() });

      const cloudMatch = /^\/clouds\/(\d+)$/.exec(path);
      if (method === "GET" && cloudMatch) {
        const id = Number(cloudMatch[1]);
        const cloud = store.getCloud(id);
        if (!cloud) return send(response, 404, { error: "点云不存在" });
        return send(response, 200, { cloud, points: store.getPoints(id) });
      }

      const analyzeMatch = /^\/clouds\/(\d+)\/analyses$/.exec(path);
      if (method === "POST" && analyzeMatch) {
        const body = await readJson(request);
        return send(response, 201, runAnalysis(store, Number(analyzeMatch[1]), {
          maxEpsilon: body.maxEpsilon === undefined ? undefined : Number(body.maxEpsilon),
          includeZeroLength: body.includeZeroLength === undefined ? undefined : Boolean(body.includeZeroLength),
          limits: body.limits as never
        }));
      }

      if (method === "GET" && path === "/analyses") {
        const cloudId = url.searchParams.get("cloudId");
        return send(response, 200, { analyses: store.listAnalyses(cloudId ? Number(cloudId) : undefined).map(({ result_json, config_json, ...item }) => ({ ...item, config: JSON.parse(config_json) })) });
      }

      const analysisMatch = /^\/analyses\/(\d+)$/.exec(path);
      if (method === "GET" && analysisMatch) {
        const analysis = store.getAnalysis(Number(analysisMatch[1]));
        if (!analysis) return send(response, 404, { error: "分析不存在" });
        return send(response, 200, { ...analysis, config: JSON.parse(analysis.config_json), result: JSON.parse(analysis.result_json) });
      }

      const barcodeMatch = /^\/analyses\/(\d+)\/barcodes$/.exec(path);
      if (method === "GET" && barcodeMatch) {
        const analysis = store.getAnalysis(Number(barcodeMatch[1]));
        if (!analysis) return send(response, 404, { error: "分析不存在" });
        const result = JSON.parse(analysis.result_json);
        return send(response, 200, { barcodes: result.barcodes, stats: result.stats });
      }

      const filtrationMatch = /^\/analyses\/(\d+)\/filtration$/.exec(path);
      if (method === "GET" && filtrationMatch) {
        const analysis = store.getAnalysis(Number(filtrationMatch[1]));
        if (!analysis) return send(response, 404, { error: "分析不存在" });
        const result = JSON.parse(analysis.result_json);
        return send(response, 200, { simplices: result.simplices.map(({ index, dimension, filtration, pointIds }: never) => ({ index, dimension, filtration, pointIds })) });
      }

      const sliceMatch = /^\/analyses\/(\d+)\/slice$/.exec(path);
      if (method === "GET" && sliceMatch) {
        const analysis = store.getAnalysis(Number(sliceMatch[1]));
        if (!analysis) return send(response, 404, { error: "分析不存在" });
        const epsilon = Number(url.searchParams.get("epsilon"));
        return send(response, 200, bettiAt(JSON.parse(analysis.result_json), epsilon));
      }

      const cycleMatch = /^\/analyses\/(\d+)\/cycle$/.exec(path);
      if (method === "GET" && cycleMatch) {
        const analysis = store.getAnalysis(Number(cycleMatch[1]));
        if (!analysis) return send(response, 404, { error: "分析不存在" });
        const birth = url.searchParams.get("birthPointIds")!.split(",");
        const cycle = representativeCycleAtBirth(JSON.parse(analysis.result_json), 1, birth);
        return send(response, 200, cycle);
      }

      const verifyMatch = /^\/analyses\/(\d+)\/verify$/.exec(path);
      if (method === "GET" && verifyMatch) {
        const analysis = store.getAnalysis(Number(verifyMatch[1]));
        if (!analysis) return send(response, 404, { error: "分析不存在" });
        const result = JSON.parse(analysis.result_json);
        const mst = mstMergeScales(result.points, result.config.maxEpsilon);
        const slice = bettiAt(result, Number(url.searchParams.get("epsilon") ?? result.config.maxEpsilon));
        const edges = result.simplices.filter((s: { dimension: number; filtration: number }) => s.dimension === 1 && s.filtration <= slice.epsilon + 1e-12).map((s: { vertices: [number, number] }) => s.vertices);
        const triangles = result.simplices.filter((s: { dimension: number; filtration: number }) => s.dimension === 2 && s.filtration <= slice.epsilon + 1e-12).map((s: { vertices: [number, number, number] }) => s.vertices);
        const rankCheck = bettiByRanks(result.points, edges, triangles);
        return send(response, 200, { epsilon: slice.epsilon, persistentBetti: slice, exhaustiveSmallMatrixRankBetti: rankCheck, mstMergeScales: mst });
      }

      const exportMatch = /^\/analyses\/(\d+)\/export$/.exec(path);
      if (method === "GET" && exportMatch) {
        const analysis = store.getAnalysis(Number(exportMatch[1]));
        if (!analysis) return send(response, 404, { error: "分析不存在" });
        const format = url.searchParams.get("format") ?? "json";
        const result = JSON.parse(analysis.result_json);
        if (format === "csv") {
          response.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="analysis-${analysis.id}.csv"` });
          return response.end(toCsv(result));
        }
        response.writeHead(200, { "content-disposition": `attachment; filename="analysis-${analysis.id}.json"` });
        return response.end(JSON.stringify({ config: JSON.parse(analysis.config_json), result }, null, 2));
      }

      if (method === "POST" && path === "/compare") {
        const body = await readJson(request);
        const first = store.getAnalysis(Number(body.leftAnalysisId));
        const second = store.getAnalysis(Number(body.rightAnalysisId));
        if (!first || !second) throw new Error("两个分析 ID 都必须存在");
        const left = JSON.parse(first.result_json);
        const right = JSON.parse(second.result_json);
        return send(response, 200, compareBarcodes(left.barcodes, right.barcodes));
      }

      if (method === "POST" && path === "/preview") {
        const body = await readJson(request);
        return send(response, 200, computePersistence(body.points as never, body.config as never));
      }

      return send(response, 404, { error: "未找到 API 路径" });
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return { server, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const dataDir = process.env.DATA_DIR ?? "data";
  const app = createApp(resolve(dataDir, "pointcloud-ph.sqlite"));
  app.server.listen(port, () => console.log(`点云持久同调服务已启动: http://localhost:${port}，数据目录: ${resolve(dataDir)}`));
}
