import { Store } from "./store.js";
import { ComputeConfig, ComputeResult, Point } from "./types.js";
import { bettiAt, computePersistence, representativeCycleAtBirth } from "./persistence.js";
import { validatePoints } from "./persistence.js";
import { bettiByRanks, compareBarcodes, mstMergeScales } from "./verification.js";

const defaultLimits = { maxPoints: 120, maxSimplices: 120000, maxMatrixEntries: 240000 };

export function runAnalysis(store: Store, cloudId: number, options: { maxEpsilon?: number; includeZeroLength?: boolean; limits?: ComputeConfig["limits"] }) {
  const cloud = store.getCloud(cloudId);
  if (!cloud) throw Object.assign(new Error("点云不存在"), { status: 404 });
  const points = validatePoints(store.getPoints(cloudId));
  const result = computePersistence(points, {
    maxEpsilon: options.maxEpsilon,
    includeZeroLength: options.includeZeroLength,
    limits: { ...defaultLimits, ...(options.limits ?? {}) }
  });
  const stored = store.saveAnalysis(cloudId, result.config, result);
  return { analysisId: stored.id, cloudId, version: stored.version, createdAt: stored.created_at, result };
}

export function toCsv(result: ComputeResult): string {
  const header = "dimension,birth,death,status,birth_simplex,death_simplex";
  const lines = result.barcodes.map((barcode) => [
    barcode.dimension,
    barcode.birth,
    barcode.death ?? "",
    barcode.status,
    barcode.birthSimplex.pointIds.join("|"),
    barcode.deathSimplex?.pointIds.join("|") ?? ""
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
  return [header, ...lines].join("\r\n");
}

export { bettiAt, bettiByRanks, compareBarcodes, computePersistence, mstMergeScales, representativeCycleAtBirth };
export type { Point };
