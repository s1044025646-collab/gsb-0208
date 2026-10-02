export function distance(a: { x: number; y: number; z?: number }, b: { x: number; y: number; z?: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function canonicalPoints(points: { id: string; x: number; y: number; z?: number }[]) {
  return [...points].sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

export function compareVertexArrays(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    if (av !== bv) return av - bv;
  }
  return a.length - b.length;
}

export function symmetricDifferenceSorted(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j === b.length || (i < a.length && a[i]! < b[j]!)) {
      out.push(a[i]!);
      i += 1;
    } else if (i === a.length || b[j]! < a[i]!) {
      out.push(b[j]!);
      j += 1;
    } else {
      i += 1;
      j += 1;
    }
  }
  return out;
}

export function boundaryOf2Chain(triangleVertexSets: number[][], edgeIndex: Map<string, number>): number[] {
  let boundary: number[] = [];
  for (const tri of triangleVertexSets) {
    const edges = [[tri[0]!, tri[1]!], [tri[0]!, tri[2]!], [tri[1]!, tri[2]!]];
    for (const edge of edges) {
      const key = edge.join(",");
      const idx = edgeIndex.get(key);
      if (idx === undefined) throw new Error(`填充三角形缺少边: ${key}`);
      boundary = symmetricDifferenceSorted(boundary, [idx]);
    }
  }
  return boundary.sort((a, b) => a - b);
}

export function edgeBoundaryIsZero(edges: number[][]): boolean {
  const parity = new Map<number, number>();
  for (const edge of edges) {
    for (const vertex of edge) {
      parity.set(vertex, (parity.get(vertex) ?? 0) ^ 1);
    }
  }
  return [...parity.values()].every((value) => value === 0);
}
