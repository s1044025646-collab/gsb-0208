import type { Bar, ComputeResult, Point, RepresentativeCycle, Simplex } from "./types.ts";
import { DEFAULT_LIMITS } from "./types.ts";
import type { BudgetLimits } from "./types.ts";
import { buildFiltration } from "./filtration.ts";

function lowBit(col: bigint): number {
  if (col === 0n) return -1;
  // 大整数二进制位长 - 1 即最高位（pivot）行索引。
  return col.toString(2).length - 1;
}

export interface PersistenceOutput {
  bars: Bar[];
  simplices: Simplex[];
  pointIds: string[];
  simplexCount: number;
  columnAdditions: number;
  aborted: boolean;
  abortReason?: string;
  /** 出生边序号 -> 代表环（边序号集合）。 */
  cycles: Map<number, bigint>;
  /** 出生边序号 -> 杀死它的三角形序号。 */
  killedBy: Map<number, number>;
}

/**
 * 标准持久同调列约化（Z2，增量算法，从左到右）：
 * R 为约化列，pivotRow -> 拥有该 pivot 的最左列。
 * 同时维护每列“由哪些原始边列 XOR 而成”的表示链 rep，
 * 使 H1 出生列（约化为零）的 rep 直接给出 GF(2) 闭合边环。
 */
export function computePersistence(
  rawPoints: Point[],
  maxScale: number,
  limits: BudgetLimits = DEFAULT_LIMITS,
): PersistenceOutput {
  const built = buildFiltration(rawPoints, maxScale, limits);
  if (built.truncated) {
    return {
      bars: [],
      simplices: [],
      pointIds: built.ordered.map((p) => p.id),
      simplexCount: 0,
      columnAdditions: 0,
      aborted: true,
      abortReason: `单纯形数量超过上限 ${limits.maxSimplices}，显式中止（未省略三角形）`,
      cycles: new Map(),
      killedBy: new Map(),
    };
  }
  const simplices = built.simplices;
  const pointIds = built.ordered.map((p) => p.id);
  const m = simplices.length;

  // 初始边界列：位集的位为“单纯形序号”（行）。
  const cols: bigint[] = new Array(m).fill(0n);
  // 边行索引映射，供三角形边界使用。
  const edgeIndex = new Map<string, number>();
  for (let j = 0; j < m; j++) {
    const s = simplices[j]!;
    if (s.dim === 1) {
      edgeIndex.set(`${s.verts[0]}_${s.verts[1]}`, j);
      cols[j] = (1n << BigInt(s.verts[0]!)) | (1n << BigInt(s.verts[1]!));
    } else if (s.dim === 2) {
      const [a, b, c] = s.verts;
      const e1 = edgeIndex.get(`${a}_${b}`)!;
      const e2 = edgeIndex.get(`${a}_${c}`)!;
      const e3 = edgeIndex.get(`${b}_${c}`)!;
      cols[j] = (1n << BigInt(e1)) | (1n << BigInt(e2)) | (1n << BigInt(e3));
    }
    // dim 0 边界列为空。
  }

  // rep[j]：当前列由哪些原始列 XOR 而来（仅对边列链有意义）。
  const rep: bigint[] = new Array(m).fill(0n);
  for (let j = 0; j < m; j++) {
    if (simplices[j]!.dim === 1) rep[j] = 1n << BigInt(j);
  }

  const pivot = new Map<number, number>();
  const paired = new Set<number>();
  let columnAdditions = 0;
  let aborted = false;
  let abortReason: string | undefined;

  for (let j = 0; j < m; j++) {
    let low = lowBit(cols[j]!);
    while (low !== -1 && pivot.has(low)) {
      const k = pivot.get(low)!;
      cols[j] = cols[j]! ^ cols[k]!;
      rep[j] = rep[j]! ^ rep[k]!;
      columnAdditions++;
      if (columnAdditions > limits.maxColumnAdditions) {
        aborted = true;
        abortReason = `列加法次数超过矩阵预算 ${limits.maxColumnAdditions}，显式中止`;
        break;
      }
      low = lowBit(cols[j]!);
    }
    if (aborted) break;
    if (low !== -1) {
      pivot.set(low, j);
      paired.add(low);
      paired.add(j);
    } else if (simplices[j]!.dim >= 1) {
      // 正维零列：H1 出生（边列约化到零）。
      if (simplices[j]!.dim === 1) {
        // 稍后由配对关系收集 rep。
      }
    }
  }

  const bars: Bar[] = [];
  const cycles = new Map<number, bigint>();
  const killedBy = new Map<number, number>();

  if (!aborted) {
    // 反向 pivot 映射：死亡列 j 对应出生列 low。
    const birthOfDeath = new Map<number, number>();
    for (const [row, deathCol] of pivot) birthOfDeath.set(deathCol, row);

    for (let j = 0; j < m; j++) {
      const s = simplices[j]!;
      if (paired.has(j)) {
        if (birthOfDeath.has(j)) {
          // j 是死亡列，配对 (birth=row, death=j)。
          const b = birthOfDeath.get(j)!;
          const birthS = simplices[b]!;
          const dim: 0 | 1 = birthS.dim === 0 ? 0 : 1;
          if (dim === 1) {
            cycles.set(b, rep[b]!);
            killedBy.set(b, j);
          }
          bars.push({
            dim,
            birth: birthS.filt,
            death: s.filt,
            censored: false,
            birthSimplex: b,
            deathSimplex: j,
            zeroLength: birthS.filt === s.filt,
          });
        }
      } else {
        // 未配对列 = 出生且存活到 maxScale：右删失。
        if (s.dim === 0 || s.dim === 1) {
          bars.push({
            dim: s.dim,
            birth: s.filt,
            death: null,
            censored: true,
            birthSimplex: j,
            deathSimplex: null,
            zeroLength: false,
          });
          if (s.dim === 1) cycles.set(j, rep[j]!);
        }
      }
    }

    // 稳定输出次序：维度、出生、死亡（删失排最后）、出生序号。
    bars.sort((a, b) => {
      if (a.dim !== b.dim) return a.dim - b.dim;
      if (a.birth !== b.birth) return a.birth - b.birth;
      const ad = a.death === null ? Infinity : a.death;
      const bd = b.death === null ? Infinity : b.death;
      if (ad !== bd) return ad - bd;
      return a.birthSimplex - b.birthSimplex;
    });
  }

  return {
    bars,
    simplices,
    pointIds,
    simplexCount: m,
    columnAdditions,
    aborted,
    abortReason,
    cycles,
    killedBy,
  };
}

export function buildResult(
  versionName: string,
  points: Point[],
  maxScale: number,
  partial: Partial<BudgetLimits> | undefined,
  keepZeroLength: boolean,
): ComputeResult {
  const limits: BudgetLimits = { ...DEFAULT_LIMITS, ...partial };
  const out = computePersistence(points, maxScale, limits);
  const bars = keepZeroLength ? out.bars : out.bars.filter((b) => !b.zeroLength);
  const cycles: Record<number, number[]> = {};
  for (const [birth, chain] of out.cycles) {
    const edges: number[] = [];
    for (let e = 0; e < out.simplices.length; e++) {
      if ((chain & (1n << BigInt(e))) !== 0n && out.simplices[e]!.dim === 1) edges.push(e);
    }
    cycles[birth] = edges;
  }
  const killedBy: Record<number, number> = {};
  for (const [birth, death] of out.killedBy) killedBy[birth] = death;
  return {
    versionName,
    pointCount: out.pointIds.length,
    simplexCount: out.simplexCount,
    limits,
    columnAdditions: out.columnAdditions,
    aborted: out.aborted,
    abortReason: out.abortReason,
    bars,
    pointIds: out.pointIds,
    simplices: out.simplices,
    cycles,
    killedBy,
    createdAt: new Date().toISOString(),
  };
}

/** 解析某条 H1 特征（按出生单纯形序号）的代表边环并做 GF(2) 边界核验。 */
export function representativeCycle(result: ComputeResult, birthSimplex: number): RepresentativeCycle | null {
  const edgeList = result.cycles[birthSimplex];
  if (!edgeList) return null;
  const edges: Array<[string, string]> = [];
  const parity = new Map<string, number>();
  for (const e of edgeList) {
    const s = result.simplices[e]!;
    if (s.dim !== 1) continue;
    const u = result.pointIds[s.verts[0]!]!;
    const v = result.pointIds[s.verts[1]!]!;
    edges.push([u, v]);
    parity.set(u, (parity.get(u) ?? 0) ^ 1);
    parity.set(v, (parity.get(v) ?? 0) ^ 1);
  }
  const boundaryParity: Record<string, number> = {};
  for (const [k, v] of parity) if (v === 1) boundaryParity[k] = 1;
  const boundaryZero = Object.keys(boundaryParity).length === 0;
  const birthScale = result.simplices[birthSimplex]!.filt;
  const deathCol = result.killedBy[birthSimplex];
  let killedByTriangle: RepresentativeCycle["killedByTriangle"] = null;
  if (deathCol !== undefined) {
    const t = result.simplices[deathCol]!;
    killedByTriangle = {
      verts: [result.pointIds[t.verts[0]!]!, result.pointIds[t.verts[1]!]!, result.pointIds[t.verts[2]!]!],
      deathScale: t.filt,
    };
  }
  return {
    barIndex: -1,
    dim: 1,
    birth: birthScale,
    edges,
    boundaryParity,
    boundaryZero,
    killedByTriangle,
    explanation:
      killedByTriangle === null
        ? `该环在尺度 ${birthScale} 出生，至用户设定的最大尺度后仍未被三角形填充，故为右删失：只能报告“尚未死亡”，不能称为永久存在。`
        : `该边链在 GF(2) 下边界为零，是尺度 ${birthScale} 出生的一维环；在尺度 ${killedByTriangle.deathScale} 三角形 ${JSON.stringify(killedByTriangle.verts)} 的边界（三条边）加入后，该环成为边界，孔洞被填充。`,
  };
}

/** 半开区间 [birth, death) 在给定尺度上的 Betti 数。 */
export function bettiAt(result: ComputeResult, scale: number): { betti0: number; betti1: number } {
  let betti0 = 0;
  let betti1 = 0;
  for (const b of result.bars) {
    if (scale < b.birth) continue;
    if (b.death !== null && scale >= b.death) continue;
    if (b.dim === 0) betti0++;
    else betti1++;
  }
  return { betti0, betti1 };
}
