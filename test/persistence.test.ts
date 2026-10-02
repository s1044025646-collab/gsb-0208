import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computePersistence, bettiAt, representativeCycleAtBirth } from "../dist/persistence.js";
import { bettiByRanks, mstMergeScales } from "../dist/verification.js";
import { Store } from "../dist/store.js";
import { runAnalysis } from "../dist/service.js";

const p = (id: string, x: number, y: number) => ({ id, x, y });
const square = [p("a", 0, 0), p("b", 1, 0), p("c", 1, 1), p("d", 0, 1)];

test("孤立点只有一条右删失 H0", () => {
  const result = computePersistence([p("a", 0, 0)], { maxEpsilon: 1 });
  assert.equal(result.barcodes.length, 1);
  assert.equal(result.barcodes[0]?.dimension, 0);
  assert.equal(result.barcodes[0]?.birth, 0);
  assert.equal(result.barcodes[0]?.death, null);
  assert.equal(result.barcodes[0]?.status, "right-censored");
  assert.deepEqual(bettiAt(result, 1), { epsilon: 1, betti0: 1, betti1: 0 });
});

test("两个点产生有限 H0，三角形不产生 H1", () => {
  const two = computePersistence([p("a", 0, 0), p("b", 1, 0)], { maxEpsilon: 2 });
  assert.equal(two.barcodes.length, 2);
  const finiteH0 = two.barcodes.find((b) => b.status === "finite")!;
  assert.equal(finiteH0.dimension, 0);
  assert.equal(finiteH0.birth, 0);
  assert.equal(finiteH0.death, 1);
  const tri = computePersistence([p("a", 0, 0), p("b", 1, 0), p("c", 0, 1)], { maxEpsilon: 2, includeZeroLength: false });
  assert.equal(tri.barcodes.some((b) => b.dimension === 1), false);
});

test("重复坐标保留编号且不合并身份", () => {
  const result = computePersistence([p("a", 0, 0), p("b", 0, 0), p("c", 2, 0)], { maxEpsilon: 3 });
  assert.equal(result.stats.pointCount, 3);
  assert.equal(result.simplices.filter((s) => s.dimension === 0).length, 3);
  assert.ok(result.simplices.some((s) => s.dimension === 1 && s.filtration === 0 && s.pointIds.join("|") === "a|b"));
});

test("单位正方形有 [1,sqrt(2)) 的 H1，代表环 GF(2) 边界为零", () => {
  const result = computePersistence(square, { maxEpsilon: Math.SQRT2 });
  const h1 = result.barcodes.filter((b) => b.dimension === 1 && b.death !== null && b.death - b.birth > 1e-12);
  assert.equal(h1.length, 1);
  assert.equal(h1[0]?.birth, 1);
  assert.ok(Math.abs((h1[0]?.death ?? NaN) - Math.SQRT2) < 1e-12);
  assert.equal(h1[0]?.status, "finite");
  const cycle = representativeCycleAtBirth(result, 1, h1[0]!.birthSimplex.pointIds);
  assert.equal(cycle.boundaryZero, true);
  assert.ok((cycle.fillTriangles?.length ?? 0) >= 1);
  assert.deepEqual(bettiAt(result, 1), { epsilon: 1, betti0: 1, betti1: 1 });
  assert.deepEqual(bettiAt(result, Math.SQRT2), { epsilon: Math.SQRT2, betti0: 1, betti1: 0 });
});

test("较低截断尺度下 H1 明确右删失，不声称永久", () => {
  const result = computePersistence(square, { maxEpsilon: 1 });
  const h1 = result.barcodes.filter((b) => b.dimension === 1);
  assert.equal(h1.length, 1);
  assert.equal(h1[0]?.birth, 1);
  assert.equal(h1[0]?.death, null);
  assert.equal(h1[0]?.status, "right-censored");
  assert.equal(representativeCycleAtBirth(result, 1, h1[0]!.birthSimplex.pointIds).boundaryZero, true);
});

test("两个簇的 H0 与独立 MST 合并尺度一致", () => {
  const points = [p("a", 0, 0), p("b", 1, 0), p("c", 10, 0), p("d", 11, 0)];
  const result = computePersistence(points, { maxEpsilon: 20, includeZeroLength: false });
  const h0Finite = result.barcodes.filter((b) => b.dimension === 0 && b.status === "finite").map((b) => b.death!);
  assert.deepEqual(h0Finite.sort((a, b) => a - b), [1, 1, 9]);
  const mst = mstMergeScales(points, 20);
  assert.deepEqual(mst.map((event) => event.epsilon), [1, 1, 9]);
  assert.deepEqual(bettiAt(result, 5), { epsilon: 5, betti0: 2, betti1: 0 });
});

test("独立小矩阵穷举秩核对 Betti 数", () => {
  const result = computePersistence(square, { maxEpsilon: 1 });
  const edges: [number, number][] = result.simplices.filter((s) => s.dimension === 1).map((s) => [s.vertices[0]!, s.vertices[1]!]);
  assert.deepEqual(bettiByRanks(result.points, edges, []), { betti0: 1, betti1: 1 });
});

test("输入重排不变且整体坐标缩放条形码尺度", () => {
  const reordered = [square[3]!, square[1]!, square[0]!, square[2]!];
  const a = computePersistence(square, { maxEpsilon: Math.SQRT2 });
  const b = computePersistence(reordered, { maxEpsilon: Math.SQRT2 });
  const signature = (result: typeof a) => result.barcodes.map((item) => `${item.dimension}:${item.birth}:${item.death}`).sort().join(";");
  assert.equal(signature(a), signature(b));
  const scaled = square.map((point) => ({ ...point, x: point.x * 2, y: point.y * 2 }));
  const c = computePersistence(scaled, { maxEpsilon: 2 * Math.SQRT2 });
  const h1 = c.barcodes.find((item) => item.dimension === 1)!;
  assert.equal(h1.birth, 2);
  assert.ok(Math.abs(h1.death! - 2 * Math.SQRT2) < 1e-12);
});

test("SQLite 保存阈值快照，重启后旧分析仍可复核，导入创建新版本", () => {
  const dir = mkdtempSync(join(tmpdir(), "pcph-"));
  const db = join(dir, "test.sqlite");
  try {
    const firstStore = new Store(db);
    const cloud = firstStore.insertCloud("square", square);
    const analysis = runAnalysis(firstStore, cloud.id, { maxEpsilon: 1 });
    assert.equal(analysis.result.stats.rightCensoredH1, 1);
    firstStore.close();
    const restarted = new Store(db);
    const cloud2 = restarted.insertCloud("square", square);
    assert.equal(cloud2.version, 2);
    const stored = restarted.getAnalysis(analysis.analysisId)!;
    const result = JSON.parse(stored.result_json);
    assert.equal(result.config.maxEpsilon, 1);
    assert.equal(result.barcodes.find((b: { dimension: number }) => b.dimension === 1).status, "right-censored");
    restarted.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("预算在计算前拒绝", () => {
  assert.throws(() => computePersistence(square, { maxEpsilon: Math.SQRT2, limits: { maxPoints: 3, maxSimplices: 100000, maxMatrixEntries: 100000 } }), /点数/);
  assert.throws(() => computePersistence(square, { maxEpsilon: Math.SQRT2, limits: { maxPoints: 100, maxSimplices: 100000, maxMatrixEntries: 10 } }), /矩阵非零项预算/);
});

