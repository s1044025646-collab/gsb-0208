import type { ComputeResult, Point } from "./types.ts";
import { distance, stabilizePoints } from "./filtration.ts";

/**
 * 独立最小生成树（Kruskal）核对 H0 合并尺度。
 * 返回 MST 边（按长度升序）；其边长正是 H0 条带的死亡尺度集合。
 */
export function mstMergeScales(rawPoints: Point[], maxScale: number): {
  edges: Array<{ a: string; b: string; length: number }>;
  merges: number[];
  componentsAtMax: number;
} {
  const points = stabilizePoints(rawPoints);
  const n = points.length;
  const all: Array<{ a: number; b: number; d: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distance(points[i]!.coord, points[j]!.coord);
      if (d <= maxScale) all.push({ a: i, b: j, d });
    }
  }
  all.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const edges: Array<{ a: string; b: string; length: number }> = [];
  const merges: number[] = [];
  let components = n;
  for (const e of all) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    components--;
    edges.push({ a: points[e.a]!.id, b: points[e.b]!.id, length: e.d });
    merges.push(e.d);
  }
  return { edges, merges, componentsAtMax: components };
}

/**
 * 小矩阵 GF(2) 穷举秩（高斯消元，bigint 位行）核对给定尺度的 Betti 数。
 * 仅在单纯形数量较小时使用（独立于持久算法，直接在该尺度重算过滤）。
 */
export function bruteBetti(rawPoints: Point[], scale: number): { betti0: number; betti1: number } {
  const points = stabilizePoints(rawPoints);
  const n = points.length;
  const V = points.map((_, i) => [i]);
  const E: number[][] = [];
  const pairEdge = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (distance(points[i]!.coord, points[j]!.coord) <= scale) {
        pairEdge.set(`${i}_${j}`, E.length);
        E.push([i, j]);
      }
    }
  }
  const T: number[][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        if (
          pairEdge.has(`${i}_${j}`) &&
          pairEdge.has(`${i}_${k}`) &&
          pairEdge.has(`${j}_${k}`)
        ) {
          T.push([i, j, k]);
        }
      }
    }
  }
  // ∂1: 列为边，行为顶点。
  const d1 = E.map(([a, b]) => (1n << BigInt(a!)) | (1n << BigInt(b!)));
  // ∂2: 列为三角形，行为边。
  const d2 = T.map(([a, b, c]) => {
    const e1 = pairEdge.get(`${a}_${b}`)!;
    const e2 = pairEdge.get(`${a}_${c}`)!;
    const e3 = pairEdge.get(`${b}_${c}`)!;
    return (1n << BigInt(e1)) | (1n << BigInt(e2)) | (1n << BigInt(e3));
  });
  const r1 = rankGf2(d1, n);
  const r2 = rankGf2(d2, E.length);
  // dim ker ∂1 = |E| - rank(∂1); H1 = ker ∂1 / im ∂2。
  return { betti0: n - r1, betti1: E.length - r1 - r2 };
}

function rankGf2(columns: bigint[], rowCount: number): number {
  const basis = new Map<number, bigint>();
  for (let col of columns) {
    let pivot = highestBit(col);
    while (pivot !== -1 && basis.has(pivot)) {
      col ^= basis.get(pivot)!;
      pivot = highestBit(col);
    }
    if (pivot !== -1) basis.set(pivot, col);
  }
  void rowCount;
  return basis.size;
}

function highestBit(x: bigint): number {
  return x === 0n ? -1 : x.toString(2).length - 1;
}

/** 版本对比：逐条比较半开区间（容差内视为相等）。 */
export function compareResults(
  a: ComputeResult,
  b: ComputeResult,
  tol = 1e-9,
): {
  onlyInA: ComputeResult["bars"];
  onlyInB: ComputeResult["bars"];
  common: number;
  pointCounts: [number, number];
  maxScales: [number, number];
} {
  const key = (bar: ComputeResult["bars"][number]): string =>
    `${bar.dim}|${bar.birth.toFixed(9)}|${bar.death === null ? "inf" : bar.death.toFixed(9)}|${bar.censored ? 1 : 0}`;
  const rounded = (bars: ComputeResult["bars"]) =>
    bars.map((bar) => ({
      bar,
      k: `${bar.dim}|${Math.round(bar.birth / tol) * tol}|${
        bar.death === null ? "inf" : Math.round(bar.death / tol) * tol
      }|${bar.censored ? 1 : 0}`,
    }));
  const ra = rounded(a.bars);
  const rb = rounded(b.bars);
  const mb = new Map<string, number>();
  for (const x of rb) mb.set(x.k, (mb.get(x.k) ?? 0) + 1);
  const onlyInA: ComputeResult["bars"] = [];
  let common = 0;
  for (const x of ra) {
    const c = mb.get(x.k) ?? 0;
    if (c > 0) {
      common++;
      mb.set(x.k, c - 1);
    } else {
      onlyInA.push(x.bar);
    }
  }
  const onlyInB: ComputeResult["bars"] = [];
  for (const x of rb) {
    if ((mb.get(x.k) ?? 0) > 0) onlyInB.push(x.bar);
  }
  void key;
  const maxOf = (r: ComputeResult) =>
    r.simplices.reduce((m, s) => Math.max(m, s.filt), 0);
  return {
    onlyInA,
    onlyInB,
    common,
    pointCounts: [a.pointCount, b.pointCount],
    maxScales: [maxOf(a), maxOf(b)],
  };
}
