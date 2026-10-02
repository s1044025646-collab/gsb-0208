export type Point = {
  id: string;
  x: number;
  y: number;
  z?: number;
};

export type Simplex = {
  dimension: 0 | 1 | 2;
  vertices: number[];
  pointIds: string[];
  filtration: number;
  index: number;
};

export type Limits = {
  maxPoints: number;
  maxSimplices: number;
  maxMatrixEntries: number;
};

export type ComputeConfig = {
  maxEpsilon: number;
  includeZeroLength: boolean;
  limits: Limits;
};

export type Barcode = {
  dimension: 0 | 1;
  birth: number;
  death: number | null;
  status: "finite" | "right-censored";
  birthSimplex: SimplexRef;
  deathSimplex: SimplexRef | null;
  representativeEdgeIds?: string[][];
  fillTriangleIds?: string[][];
};

export type SimplexRef = {
  dimension: 0 | 1 | 2;
  pointIds: string[];
  filtration: number;
};

export type BettiSlice = {
  epsilon: number;
  betti0: number;
  betti1: number;
};

export type ComputeResult = {
  config: ComputeConfig;
  points: Point[];
  simplices: Simplex[];
  barcodes: Barcode[];
  stats: {
    pointCount: number;
    vertexCount: number;
    edgeCount: number;
    triangleCount: number;
    simplexCount: number;
    matrixEntryBudget: number;
    matrixEntriesUsed: number;
    reducedColumns: number;
    rightCensoredH0: number;
    rightCensoredH1: number;
  };
};
