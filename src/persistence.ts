import { Point, Simplex, ComputeConfig, ComputeResult, Barcode, SimplexRef, BettiSlice } from "./types.js";
import { boundaryOf2Chain, canonicalPoints, compareVertexArrays, distance, edgeBoundaryIsZero, symmetricDifferenceSorted } from "./gf2.js";

const EPS = 1e-12;

export function validatePoints(input: Point[]): Point[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("点云至少需要一个点");
  const seen = new Set<string>();
  return input.map((point) => {
    if (typeof point.id !== "string" || point.id.length === 0) throw new Error("每个点必须有非空字符串编号");
    if (seen.has(point.id)) throw new Error(`重复点编号: ${point.id}`);
    seen.add(point.id);
    for (const coordName of ["x", "y"] as const) {
      const value: number | undefined = point[coordName];
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`点 ${point.id} 的 ${coordName} 必须是有限数字`);
    }
    if (point.z !== undefined && (typeof point.z !== "number" || !Number.isFinite(point.z))) {
      throw new Error(`点 ${point.id} 的 z 必须是有限数字`);
    }
    return { id: point.id, x: point.x, y: point.y, ...(point.z === undefined ? {} : { z: point.z }) };
  });
}

function ref(simplex: Simplex): SimplexRef {
  return { dimension: simplex.dimension, pointIds: simplex.pointIds, filtration: simplex.filtration };
}

function idsFromVertexList(resultPoints: Point[], vertices: number[]): string[] {
  return vertices.map((vertex) => resultPoints[vertex]!.id);
}

function edgesFromTriangleChain(result: ComputeResultShape, triangleChain: number[]): string[][] {
  const edgeIndexSet = new Set<string>();
  for (const triangleIndex of triangleChain) {
    const triangle = result.simplices[triangleIndex]!;
    const [a, b, c] = triangle.vertices;
    for (const pair of [[a!, b!], [a!, c!], [b!, c!]]) {
      const key = [...pair].sort((x, y) => x - y).join(",");
      const existing = edgeIndexSet.has(key);
      if (existing) edgeIndexSet.delete(key);
      else edgeIndexSet.add(key);
    }
  }
  return [...edgeIndexSet].map((key) => key.split(",").map((vertex) => result.points[Number(vertex)]!.id));
}

function earlierTreePathCycle(result: ComputeResultShape, birth: Simplex): string[][] {
  const start = birth.vertices[0]!;
  const target = birth.vertices[1]!;
  const previous = new Map<number, [number | null, number | null]>([[start, [null, null]]]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const vertex = queue[cursor]!;
    if (vertex === target) break;
    for (const edge of result.simplices) {
      if (edge.dimension !== 1 || edge.index >= birth.index) continue;
      let other: number | null = null;
      if (edge.vertices[0] === vertex) other = edge.vertices[1]!;
      if (edge.vertices[1] === vertex) other = edge.vertices[0]!;
      if (other !== null && !previous.has(other)) {
        previous.set(other, [vertex, edge.index]);
        queue.push(other);
      }
    }
  }
  if (!previous.has(target)) return [birth.pointIds];
  const edgeIndices = [birth.index];
  let current: number | null = target;
  while (current !== null && current !== start) {
    const [parent, edgeIndex]: [number | null, number | null] = previous.get(current)!;
    edgeIndices.push(edgeIndex!);
    current = parent;
  }
  return edgeIndices.map((index) => idsFromVertexList(result.points, result.simplices[index]!.vertices));
}

type ComputeResultShape = {
  points: Point[];
  simplices: Simplex[];
};

export function buildRipsSimplices(rawPoints: Point[], config: ComputeConfig): { points: Point[]; simplices: Simplex[]; matrixEntries: number } {
  const points = canonicalPoints(validatePoints(rawPoints));
  if (points.length > config.limits.maxPoints) throw new Error(`点数 ${points.length} 超过上限 ${config.limits.maxPoints}`);
  if (!(config.maxEpsilon >= 0) || !Number.isFinite(config.maxEpsilon)) throw new Error("最大尺度必须是非负有限数");

  const n = points.length;
  const vertices: Simplex[] = points.map((point, index) => ({
    dimension: 0,
    vertices: [index],
    pointIds: [point.id],
    filtration: 0,
    index: -1
  }));

  const edges: Simplex[] = [];
  const edgeByPair = new Map<string, Simplex>();
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = distance(points[i]!, points[j]!);
      if (d <= config.maxEpsilon + EPS) {
        const edge: Simplex = { dimension: 1, vertices: [i, j], pointIds: [points[i]!.id, points[j]!.id], filtration: d, index: -1 };
        edges.push(edge);
        edgeByPair.set(`${i},${j}`, edge);
      }
    }
  }

  const triangles: Simplex[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      for (let k = j + 1; k < n; k += 1) {
        const ij = edgeByPair.get(`${i},${j}`)!;
        const ik = edgeByPair.get(`${i},${k}`)!;
        const jk = edgeByPair.get(`${j},${k}`)!;
        if (ij && ik && jk) {
          const longest = Math.max(ij.filtration, ik.filtration, jk.filtration);
          triangles.push({
            dimension: 2,
            vertices: [i, j, k],
            pointIds: [points[i]!.id, points[j]!.id, points[k]!.id],
            filtration: longest,
            index: -1
          });
        }
      }
    }
  }

  let matrixEntries = edges.length * 2 + triangles.length * 3;
  if (matrixEntries > config.limits.maxMatrixEntries) {
    throw new Error(`矩阵非零项预算 ${matrixEntries} 超过上限 ${config.limits.maxMatrixEntries}；未开始约化`);
  }

  const simplices = [...vertices, ...edges, ...triangles];
  simplices.sort((a, b) => {
    const delta = a.filtration - b.filtration;
    if (Math.abs(delta) > EPS) return delta;
    if (a.dimension !== b.dimension) return a.dimension - b.dimension;
    return compareVertexArrays(a.vertices, b.vertices);
  });
  simplices.forEach((simplex, index) => { simplex.index = index; });

  if (simplices.length > config.limits.maxSimplices) {
    throw new Error(`单纯形数量 ${simplices.length} 超过上限 ${config.limits.maxSimplices}；未返回结果`);
  }
  return { points, simplices, matrixEntries };
}

function initialColumn(simplex: Simplex, indexOf: Map<string, number>): number[] {
  if (simplex.dimension === 0) return [];
  if (simplex.dimension === 1) return simplex.vertices.map((v) => indexOf.get(`${v}`)!).sort((a, b) => a - b);
  const [i, j, k] = simplex.vertices;
  return [[i, j], [i, k], [j, k]]
    .map(([a, b]) => indexOf.get(`${a!},${b!}`)!)
    .sort((a, b) => a - b);
}

export function computePersistence(rawPoints: Point[], supplied: Partial<ComputeConfig> = {}): ComputeResult {
  const config: ComputeConfig = {
    maxEpsilon: supplied.maxEpsilon ?? Number.POSITIVE_INFINITY,
    includeZeroLength: supplied.includeZeroLength ?? true,
    limits: supplied.limits ?? { maxPoints: 120, maxSimplices: 120000, maxMatrixEntries: 240000 }
  };
  if (!Number.isFinite(config.maxEpsilon)) {
    const points = canonicalPoints(validatePoints(rawPoints));
    let maximum = 0;
    for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) maximum = Math.max(maximum, distance(points[i]!, points[j]!));
    config.maxEpsilon = maximum;
  }

  const { points, simplices, matrixEntries } = buildRipsSimplices(rawPoints, config);
  const indexOf = new Map<string, number>();
  simplices.forEach((simplex) => indexOf.set(simplex.vertices.join(","), simplex.index));

  const low: (number | null)[] = new Array(simplices.length).fill(null);
  const pivotToSimplex = new Map<number, number>();
  const columns: number[][] = simplices.map((simplex) => initialColumn(simplex, indexOf));
  const chains: number[][] = simplices.map((simplex) => simplex.dimension === 0 ? [] : [simplex.index]);
  let activeMatrixEntries = columns.reduce((total, column) => total + column.length, 0);
  const barcodesByBirth = new Map<number, Barcode>();
  const barcodes: Barcode[] = [];
  let reducedColumns = 0;

  for (let columnIndex = 0; columnIndex < simplices.length; columnIndex += 1) {
    let current = columns[columnIndex]!;
    while (current.length > 0) {
      const pivot = current[current.length - 1]!;
      const owner = pivotToSimplex.get(pivot);
      if (owner === undefined) break;
      const nextColumn = symmetricDifferenceSorted(current, columns[owner]!);
      const nextChain = symmetricDifferenceSorted(chains[columnIndex]!, chains[owner]!);
      const candidateEntries = activeMatrixEntries - current.length + nextColumn.length;
      if (candidateEntries > config.limits.maxMatrixEntries) {
        throw new Error(`GF(2) 约化填充项使矩阵预算超过 ${config.limits.maxMatrixEntries}；已中止，未保存结果`);
      }
      activeMatrixEntries = candidateEntries;
      current = nextColumn;
      chains[columnIndex] = nextChain;
    }
    columns[columnIndex] = current;
    reducedColumns += 1;
    const simplex = simplices[columnIndex]!;
    if (current.length === 0) {
      if (simplex.dimension === 0) {
        const barcode: Barcode = { dimension: 0, birth: 0, death: null, status: "right-censored", birthSimplex: ref(simplex), deathSimplex: null };
        barcodesByBirth.set(simplex.index, barcode);
        barcodes.push(barcode);
      } else if (simplex.dimension === 1) {
        const barcode: Barcode = { dimension: 1, birth: simplex.filtration, death: null, status: "right-censored", birthSimplex: ref(simplex), deathSimplex: null, representativeEdgeIds: [] };
        barcodesByBirth.set(simplex.index, barcode);
        barcodes.push(barcode);
      }
    } else {
      const pivot = current[current.length - 1]!;
      low[columnIndex] = pivot;
      pivotToSimplex.set(pivot, columnIndex);
      const birthSimplex = simplices[pivot]!;
      const deathSimplex = simplex;
      const dimension = birthSimplex.dimension;
      const barcode = barcodesByBirth.get(pivot);
      if (!barcode) throw new Error("内部错误：死亡单纯形找不到对应出生条形码");
      const zeroLength = Math.abs(birthSimplex.filtration - deathSimplex.filtration) <= EPS;
      if (zeroLength && !config.includeZeroLength) {
        barcodesByBirth.delete(pivot);
        const position = barcodes.indexOf(barcode);
        if (position >= 0) barcodes.splice(position, 1);
      } else {
        barcode.death = deathSimplex.filtration;
        barcode.status = "finite";
        barcode.deathSimplex = ref(deathSimplex);
        if (dimension === 1) {
          const triangleChain = chains[columnIndex]!;
          barcode.representativeEdgeIds = edgesFromTriangleChain({ points, simplices }, triangleChain);
          if (deathSimplex.dimension === 2) {
            barcode.fillTriangleIds = chains[columnIndex]!.map((idx) => simplices[idx]!).filter((s) => s.dimension === 2).map((tri) => tri.pointIds);
          }
        }
      }
    }
  }

  for (const barcode of barcodes) {
    if (barcode.dimension === 1 && barcode.status === "right-censored") {
      const birthSimplex = simplices.find((simplex) => simplex.pointIds.join("|") === barcode.birthSimplex.pointIds.join("|") && simplex.dimension === 1)!;
      barcode.representativeEdgeIds = earlierTreePathCycle({ points, simplices }, birthSimplex);
    }
  }
  barcodes.sort((a, b) => a.dimension - b.dimension || a.birth - b.birth || (a.death ?? Number.POSITIVE_INFINITY) - (b.death ?? Number.POSITIVE_INFINITY) || a.birthSimplex.pointIds.join("|").localeCompare(b.birthSimplex.pointIds.join("|")));

  const edges = simplices.filter((s) => s.dimension === 1).length;
  const triangles = simplices.filter((s) => s.dimension === 2).length;
  return {
    config,
    points,
    simplices,
    barcodes,
    stats: {
      pointCount: points.length,
      vertexCount: points.length,
      edgeCount: edges,
      triangleCount: triangles,
      simplexCount: simplices.length,
      matrixEntryBudget: config.limits.maxMatrixEntries,
      matrixEntriesUsed: Math.max(matrixEntries, activeMatrixEntries),
      reducedColumns,
      rightCensoredH0: barcodes.filter((b) => b.dimension === 0 && b.status === "right-censored").length,
      rightCensoredH1: barcodes.filter((b) => b.dimension === 1 && b.status === "right-censored").length
    }
  };
}

export function bettiAt(result: ComputeResult, epsilon: number): BettiSlice {
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new Error("尺度必须是非负有限数");
  const alive = result.barcodes.filter((b) => b.birth <= epsilon + EPS && (b.death === null || epsilon < b.death - EPS));
  return {
    epsilon,
    betti0: alive.filter((b) => b.dimension === 0).length,
    betti1: alive.filter((b) => b.dimension === 1).length
  };
}

export function representativeCycleAtBirth(result: ComputeResult, dimension: 0 | 1, birthPointIds: string[]): { edges: string[][]; boundaryZero: boolean; fillTriangles: string[][] | null; death: number | null } {
  const barcode = result.barcodes.find((b) => b.dimension === dimension && b.birthSimplex.pointIds.join("|") === birthPointIds.join("|"));
  if (!barcode) throw new Error("未找到指定条形码");
  const edges = barcode.representativeEdgeIds ?? [];
  const pointIndex = new Map(result.points.map((p, i) => [p.id, i]));
  const numericEdges = edges.map((ids) => ids.map((id) => pointIndex.get(id)!));
  return {
    edges,
    boundaryZero: dimension === 1 ? edgeBoundaryIsZero(numericEdges) : true,
    fillTriangles: barcode.fillTriangleIds ?? null,
    death: barcode.death
  };
}

export { boundaryOf2Chain };
