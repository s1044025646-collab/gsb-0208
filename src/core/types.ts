/**
 * 核心类型定义。
 *
 * 约定：
 * - 点具有唯一编号 id（字符串）与有限坐标。重复坐标的点保留各自 id，不做合并。
 * - 过滤值为非负有限数。相同过滤值时，面先于余面：顶点 < 边 < 三角形，
 *   同维度内按顶点索引组成的严格递增元组的字典序排序（公开且稳定的平局规则）。
 */

export type Dim = 0 | 1 | 2;

export interface Point {
  id: string;
  coord: number[];
}

/** 单纯形：顶点为点云中按稳定排序后的内部索引（0..n-1）。 */
export interface Simplex {
  /** 严格递增的内部点索引元组。 */
  verts: number[];
  dim: Dim;
  /** 过滤值：顶点 0；边为距离；三角形为最长边长度。 */
  filt: number;
}

export interface BudgetLimits {
  maxPoints: number;
  maxSimplices: number;
  /** 约化阶段允许的列加法次数上限（矩阵预算的一部分）。 */
  maxColumnAdditions: number;
}

export const DEFAULT_LIMITS: BudgetLimits = {
  maxPoints: 200,
  maxSimplices: 2_000_000,
  maxColumnAdditions: 200_000_000,
};

export interface ComputeConfig {
  /** 距离尺度上限 epsilon_max；达到后仍存活的条带为右删失。 */
  maxScale: number;
  /** 点云版本名（数据库内唯一）。 */
  name: string;
  limits?: Partial<BudgetLimits>;
  /** 是否保留零长度条带（birth == death）。默认 false：省略。 */
  keepZeroLength?: boolean;
}

export interface Bar {
  dim: Dim;
  birth: number;
  /** 右删失时为 null，表示“未计算到死亡”，不得解释为永久存在。 */
  death: number | null;
  censored: boolean;
  /** 出生单纯形（在过滤结构中的序号）。 */
  birthSimplex: number;
  /** 死亡单纯形序号；右删失时为 null。 */
  deathSimplex: number | null;
  /** 零长度条带标记（birth === death，仅 keepZeroLength 时出现）。 */
  zeroLength: boolean;
}

export interface RepresentativeCycle {
  barIndex: number;
  dim: Dim;
  birth: number;
  /** 组成代表环的边，每条以点 id 对给出。 */
  edges: Array<[string, string]>;
  /** GF(2) 边界：每个出现奇数次的点 id -> 1（核验结果应为空）。 */
  boundaryParity: Record<string, number>;
  boundaryZero: boolean;
  /** 死亡尺度上填充该环的三角形（若已死亡）。 */
  killedByTriangle: { verts: [string, string, string]; deathScale: number } | null;
  explanation: string;
}

export interface ComputeResult {
  versionName: string;
  pointCount: number;
  simplexCount: number;
  /** 实际使用的预算上限。 */
  limits: BudgetLimits;
  /** 列加法次数（矩阵预算消耗）。 */
  columnAdditions: number;
  aborted: boolean;
  abortReason?: string;
  bars: Bar[];
  /** 内部点索引 -> 点 id 映射。 */
  pointIds: string[];
  /** 有序过滤单纯形（序号即数组下标）。 */
  simplices: Simplex[];
  /** H1 出生单纯形序号 -> 代表环的边单纯形序号列表。 */
  cycles: Record<number, number[]>;
  /** H1 出生单纯形序号 -> 杀死它的三角形单纯形序号。 */
  killedBy: Record<number, number>;
  createdAt: string;
}

export interface BettiSlice {
  scale: number;
  /** 半开区间 [birth, death) 在该尺度计数。 */
  betti0: number;
  betti1: number;
}
