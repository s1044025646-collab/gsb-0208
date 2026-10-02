import type { ComputeResult } from "./types.ts";

export function barsToCsv(result: ComputeResult): string {
  const header = "dim,birth,death,censored,zero_length,birth_simplex,death_simplex";
  const lines = result.bars.map((b) =>
    [
      b.dim,
      b.birth,
      b.death === null ? "" : b.death,
      b.censored ? 1 : 0,
      b.zeroLength ? 1 : 0,
      b.birthSimplex,
      b.deathSimplex === null ? "" : b.deathSimplex,
    ].join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

export function filtrationToCsv(result: ComputeResult): string {
  const header = "index,dim,filt,verts";
  const lines = result.simplices.map((s, i) =>
    [i, s.dim, s.filt, `"${s.verts.map((v) => result.pointIds[v]).join("|")}"`].join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

export function resultToJson(result: ComputeResult): string {
  return JSON.stringify(result, null, 2);
}
