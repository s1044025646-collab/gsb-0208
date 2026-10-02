import type { Point, Simplex, Dim, BudgetLimits } from "./types.ts";

export function assertFinitePoint(p: Point): void {
  if (!Array.isArray(p.coord) || (p.coord.length !== 2 && p.coord.length !== 3)) {
    throw new Error(`点 ${p.id} 的坐标必须是二维或三维数组`);
  }
  for (const x of p.coord) {
    if (typeof x !== "number" || !Number.isFinite(x)) {
      throw new Error(`点 ${p.id} 含非有限坐标，拒绝计算`);
    }
  }
}

export function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(s);
}

/**
 * 稳定点排序：按 (id 字典序, 坐标字典序)。
 * 输入顺序变化不影响内部索引，从而保证条形码重排不变。
 */
export function stabilizePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  for (const p of points) {
    if (seen.has(p.id)) throw new Error(`点 id 重复：${p.id}`);
    seen.add(p.id);
    assertFinitePoint(p);
  }
  return [...points].sort((p, q) => {
    if (p.id < q.id) return -1;
    if (p.id > q.id) return 1;
    const d = Math.min(p.coord.length, q.coord.length);
    for (let i = 0; i < d; i++) {
      if (p.coord[i]! !== q.coord[i]!) return p.coord[i]! - q.coord[i]!;
    }
    return p.coord.length - q.coord.length;
  });
}

/** 单纯形平局比较：过滤值相同的情况下，(维度, 顶点元组字典序)。 */
function simplexLess(a: Simplex, b: Simplex): number {
  if (a.filt < b.filt) return -1;
  if (a.filt > b.filt) return 1;
  if (a.dim !== b.dim) return a.dim - b.dim;
  const n = Math.min(a.verts.length, b.verts.length);
  for (let i = 0; i < n; i++) {
    if (a.verts[i]! !== b.verts[i]!) return a.verts[i]! - b.verts[i]!;
  }
  return a.verts.length - b.verts.length;
}

export interface FiltrationBuild {
  simplices: Simplex[];
  ordered: Point[];
  truncated: boolean;
}

/**
 * 构造至多二维的 Vietoris–Rips 过滤。
 * - 顶点在 0 出现；
 * - 边 {i,j} 在 dist <= maxScale 时出现，过滤值为距离；
 * - 三角形 {i,j,k} 在三条边都存在时出现，过滤值为最长边长度。
 * 预算超限在构造前/构造中显式拒绝（aborted），绝不偷偷丢弃三角形。
 */
export function buildFiltration(
  rawPoints: Point[],
  maxScale: number,
  limits: BudgetLimits,
): FiltrationBuild {
  if (!Number.isFinite(maxScale) || maxScale < 0) {
    throw new Error("maxScale 必须为非负有限数");
  }
  const ordered = stabilizePoints(rawPoints);
  const n = ordered.length;
  if (n > limits.maxPoints) {
    throw new Error(`点数 ${n} 超过上限 ${limits.maxPoints}，计算前拒绝`);
  }

  const simplices: Simplex[] = [];
  for (let i = 0; i < n; i++) {
    simplices.push({ verts: [i], dim: 0 as Dim, filt: 0 });
  }

  const coords = ordered.map((p) => p.coord);
  /** 边过滤值矩阵，供三角形判断与最长边取值。 */
  const edgeFilt: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distance(coords[i]!, coords[j]!);
      if (d <= maxScale) {
        edgeFilt[i]![j] = d;
        simplices.push({ verts: [i, j], dim: 1 as Dim, filt: d });
      }
    }
  }

  let aborted: { reason: string } | null = null;
  outer: for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (edgeFilt[i]![j] === Infinity) continue;
      for (let k = j + 1; k < n; k++) {
        if (edgeFilt[i]![k] === Infinity || edgeFilt[j]![k] === Infinity) continue;
        const longest = Math.max(edgeFilt[i]![j]!, edgeFilt[i]![k]!, edgeFilt[j]![k]!);
        simplices.push({ verts: [i, j, k], dim: 2 as Dim, filt: longest });
        if (simplices.length > limits.maxSimplices) {
          aborted = { reason: `单纯形数量超过上限 ${limits.maxSimplices}，显式中止（未省略三角形）` };
          break outer;
        }
      }
    }
  }

  if (aborted) {
    return { simplices: [], ordered, truncated: true };
  }

  // 公开稳定次序：过滤值升序；平局时维度升序（面先于余面），再按顶点元组字典序。
  simplices.sort(simplexLess);
  return { simplices, ordered, truncated: false };
}

export function simplexKey(s: Simplex, pointIds: string[]): string[] {
  return s.verts.map((v) => pointIds[v]!);
}
