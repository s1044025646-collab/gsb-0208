import { Point } from "./types.js";
import { distance, symmetricDifferenceSorted } from "./gf2.js";

export type MstEvent = { epsilon: number; mergedComponents: number };

export function mstMergeScales(points: Point[], maxEpsilon: number): MstEvent[] {
  const sorted = [...points].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parent = new Map(sorted.map((point) => [point.id, point.id]));
  function find(id: string): string {
    let current = id;
    while (parent.get(current) !== current) {
      current = parent.get(current)!;
      parent.set(id, current);
    }
    return current;
  }
  const edges: { a: string; b: string; d: number }[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const d = distance(sorted[i]!, sorted[j]!);
      if (d <= maxEpsilon + 1e-12) edges.push({ a: sorted[i]!.id, b: sorted[j]!.id, d });
    }
  }
  edges.sort((x, y) => x.d - y.d || (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) || (x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
  let components = sorted.length;
  const events: MstEvent[] = [];
  for (const edge of edges) {
    const ra = find(edge.a);
    const rb = find(edge.b);
    if (ra !== rb) {
      parent.set(rb, ra);
      components -= 1;
      events.push({ epsilon: edge.d, mergedComponents: components });
    }
  }
  return events;
}

export function gf2Rank(columns: number[][], rowCount: number): number {
  const basis = new Map<number, number[]>();
  for (const suppliedColumn of columns) {
    let column = [...suppliedColumn].sort((a, b) => a - b);
    while (column.length > 0) {
      const pivot = column[column.length - 1]!;
      const owner = basis.get(pivot);
      if (!owner) {
        basis.set(pivot, column);
        break;
      }
      column = symmetricDifferenceSorted(column, owner);
    }
  }
  return basis.size;
}

export function bettiByRanks(points: Point[], edges: [number, number][], triangles: [number, number, number][]): { betti0: number; betti1: number } {
  const v = points.length;
  const e = edges.length;
  const f = triangles.length;
  const boundary1 = edges.map(([a, b]) => [a, b].sort((x, y) => x - y));
  const boundary2 = triangles.map(([a, b, c]) => {
    const edgeIds: number[] = [];
    for (const pair of [[a, b], [a, c], [b, c]]) {
      const key = pair.slice().sort((x, y) => x - y).join(",");
      edgeIds.push(edges.findIndex((edge) => edge.slice().sort((x, y) => x - y).join(",") === key));
    }
    return edgeIds.sort((a, b) => a - b);
  });
  const rankD1 = gf2Rank(boundary1, v);
  const rankD2 = gf2Rank(boundary2, e);
  return { betti0: v - rankD1, betti1: e - rankD1 - rankD2 };
}

export function compareBarcodes(left: { dimension: number; birth: number; death: number | null }[], right: typeof left) {
  const signature = (items: typeof left) => items
    .map((item) => `${item.dimension}:${item.birth.toFixed(12)}:${item.death === null ? "censored" : item.death.toFixed(12)}`)
    .sort()
    .join(";");
  return { equal: signature(left) === signature(right), left: signature(left), right: signature(right) };
}
