import { test } from "node:test";
import assert from "node:assert/strict";
import { computePersistence } from "../src/core/persistence.ts";
import { bettiAt, buildResult, representativeCycle } from "../src/core/persistence.ts";
import { bruteBetti, mstMergeScales } from "../src/core/crosscheck.ts";
import { DEFAULT_LIMITS, type Point } from "../src/core/types.ts";

const SQRT2 = Math.SQRT2;

function h0(out: ReturnType<typeof computePersistence>) {
  return out.bars.filter((b) => b.dim === 0);
}
function h1(out: ReturnType<typeof computePersistence>) {
  return out.bars.filter((b) => b.dim === 1);
}

test("孤立点：3 个点全部右删失，Betti=(3,0)", () => {
  const pts: Point[] = [
    { id: "a", coord: [0, 0] },
    { id: "b", coord: [10, 0] },
    { id: "c", coord: [0, 10] },
  ];
  const out = computePersistence(pts, 5, DEFAULT_LIMITS);
  assert.equal(out.aborted, false);
  assert.equal(h0(out).length, 3);
  assert.ok(h0(out).every((b) => b.censored));
  assert.deepEqual(bettiAt(resultOf(pts, 5), 5), { betti0: 3, betti1: 0 });
});

test("两个点：H0 一条 [0,d) 死亡条 + 一条删失，无 H1", () => {
  const pts: Point[] = [
    { id: "p", coord: [0, 0] },
    { id: "q", coord: [3, 4] },
  ];
  const out = computePersistence(pts, 10, DEFAULT_LIMITS);
  const dead = h0(out).filter((b) => !b.censored);
  assert.equal(dead.length, 1);
  assert.equal(dead[0]!.birth, 0);
  assert.ok(Math.abs(dead[0]!.death! - 5) < 1e-12);
  assert.equal(h1(out).length, 0);
  const res = resultOf(pts, 10);
  assert.deepEqual(bettiAt(res, 4.9), { betti0: 2, betti1: 0 });
  assert.deepEqual(bettiAt(res, 5), { betti0: 1, betti1: 0 });
});

test("三角形：出生即被填充的零长度 H1 默认省略，保留时显式标记", () => {
  const pts: Point[] = [
    { id: "a", coord: [0, 0] },
    { id: "b", coord: [1, 0] },
    { id: "c", coord: [0.5, Math.sqrt(3) / 2] },
  ];
  const out = computePersistence(pts, 2, DEFAULT_LIMITS);
  assert.equal(h1(out).filter((b) => !b.zeroLength).length, 0);
  const zero = h1(out).filter((b) => b.zeroLength);
  assert.equal(zero.length, 1);
  assert.equal(zero[0]!.birth, zero[0]!.death);
  const kept = buildResult("tri", pts, 2, undefined, true);
  assert.equal(kept.bars.filter((b) => b.dim === 1 && b.zeroLength).length, 1);
});

test("重复坐标：保留各自 id，得到零长度 H0 死亡条", () => {
  const pts: Point[] = [
    { id: "x1", coord: [1, 1] },
    { id: "x2", coord: [1, 1] },
    { id: "y", coord: [5, 5] },
  ];
  const out = computePersistence(pts, 10, DEFAULT_LIMITS);
  const zero = h0(out).filter((b) => b.death === 0);
  assert.equal(zero.length, 1, "重复坐标点在尺度 0 合并，不静默丢点");
  assert.equal(out.pointIds.length, 3);
  const ids = new Set(out.simplices.filter((s) => s.dim === 0).flatMap((s) => s.verts.map((v) => out.pointIds[v])));
  assert.deepEqual([...ids].sort(), ["x1", "x2", "y"]);
});

test("两个簇：簇内连通、簇间删失，MST 与 H0 死亡尺度一致", () => {
  const pts: Point[] = [
    { id: "a0", coord: [0, 0] },
    { id: "a1", coord: [1, 0] },
    { id: "b0", coord: [10, 0] },
    { id: "b1", coord: [11, 0] },
  ];
  const scale = 5;
  const res = resultOf(pts, scale);
  assert.deepEqual(bettiAt(res, scale), { betti0: 2, betti1: 0 });
  const mst = mstMergeScales(pts, scale);
  assert.equal(mst.componentsAtMax, 2);
  assert.deepEqual(mst.merges, [1, 1]);
  const h0Deaths = res.bars.filter((b) => b.dim === 0 && !b.censored).map((b) => b.death);
  assert.deepEqual([...h0Deaths].sort(), [1, 1]);
});

test("单位正方形：恰有一条 [1,sqrt(2)) 的正长度 H1，代表环边界为零", () => {
  const pts = square();
  const res = resultOf(pts, SQRT2);
  const positiveH1 = res.bars.filter((b) => b.dim === 1 && !b.zeroLength && !b.censored);
  assert.equal(positiveH1.length, 1);
  const bar = positiveH1[0]!;
  assert.ok(Math.abs(bar.birth - 1) < 1e-12, "birth=1");
  assert.ok(Math.abs(bar.death! - SQRT2) < 1e-12, "death=sqrt(2)");
  assert.deepEqual(bettiAt(res, 1), { betti0: 1, betti1: 1 });
  assert.deepEqual(bettiAt(res, SQRT2), { betti0: 1, betti1: 0 });
  const cycle = representativeCycle(res, bar.birthSimplex)!;
  assert.equal(cycle.boundaryZero, true);
  assert.ok(cycle.edges.length === 4, "代表环为四条边");
  assert.ok(cycle.killedByTriangle, "被三角形填充");
  assert.ok(Math.abs(cycle.killedByTriangle!.deathScale - SQRT2) < 1e-12);
});

test("正方形截断在 1.2：H1 右删失，只能报告尚未死亡", () => {
  const pts = square();
  const res = resultOf(pts, 1.2);
  const h1bars = res.bars.filter((b) => b.dim === 1);
  assert.equal(h1bars.length, 1);
  assert.equal(h1bars[0]!.censored, true);
  assert.equal(h1bars[0]!.death, null);
  assert.deepEqual(bettiAt(res, 1.2), { betti0: 1, betti1: 1 });
  const cycle = representativeCycle(res, h1bars[0]!.birthSimplex)!;
  assert.equal(cycle.killedByTriangle, null);
  assert.match(cycle.explanation, /右删失/);
});

test("重排不变：打乱输入顺序得到相同正长度条形码", () => {
  const a = square();
  const b = [...a].reverse().map((p) => ({ ...p }));
  const ra = resultOf(a, SQRT2);
  const rb = resultOf(b, SQRT2);
  const norm = (r: typeof ra) =>
    r.bars
      .filter((x) => !x.zeroLength)
      .map((x) => `${x.dim}:${x.birth.toFixed(9)}:${x.death === null ? "inf" : x.death.toFixed(9)}:${x.censored}`)
      .sort();
  assert.deepEqual(norm(ra), norm(rb));
});

test("整体缩放 c：区间端点同比例缩放", () => {
  const c = 3;
  const small = square();
  const big = square().map((p) => ({ id: p.id, coord: p.coord.map((v) => v * c) }));
  const rs = resultOf(small, SQRT2 + 0.1);
  const rb = resultOf(big, (SQRT2 + 0.1) * c);
  const bs = rs.bars.filter((x) => x.dim === 1 && !x.censored && !x.zeroLength);
  const bb = rb.bars.filter((x) => x.dim === 1 && !x.censored && !x.zeroLength);
  assert.equal(bs.length, 1);
  assert.equal(bb.length, 1);
  assert.ok(Math.abs(bb[0]!.birth - bs[0]!.birth * c) < 1e-9);
  assert.ok(Math.abs(bb[0]!.death! - bs[0]!.death! * c) < 1e-9);
});

test("小矩阵穷举秩在多个尺度上与条形码 Betti 一致", () => {
  const pts = square();
  const res = resultOf(pts, SQRT2);
  for (const s of [0, 0.5, 1, 1.2, SQRT2 - 1e-9, SQRT2, 2]) {
    assert.deepEqual(bettiAt(res, s), bruteBetti(pts, s), `尺度 ${s}`);
  }
});

test("预算超限：点过多在计算前拒绝", () => {
  const pts: Point[] = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, coord: [i, 0] }));
  assert.throws(() => computePersistence(pts, 100, { ...DEFAULT_LIMITS, maxPoints: 5 }), /超过上限/);
});

test("预算超限：单纯形过多显式中止且 aborted=true", () => {
  const pts: Point[] = [];
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) pts.push({ id: `p${i}_${j}`, coord: [i, j] });
  const out = computePersistence(pts, 100, { ...DEFAULT_LIMITS, maxSimplices: 50 });
  assert.equal(out.aborted, true);
  assert.match(out.abortReason!, /显式中止/);
});

function square(): Point[] {
  return [
    { id: "0", coord: [0, 0] },
    { id: "1", coord: [1, 0] },
    { id: "2", coord: [1, 1] },
    { id: "3", coord: [0, 1] },
  ];
}

function resultOf(pts: Point[], scale: number) {
  return buildResult("v", pts, scale, undefined, false);
}
