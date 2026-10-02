/**
 * 端到端演示（不启动 HTTP 服务）：
 * 1. 单位正方形孔洞在尺度 1 出生、在 sqrt(2) 被对角线三角形填充；
 * 2. 截断 maxScale=1.2 时只能报告右删失（尚未死亡），不能宣称永久；
 * 3. 结果写入项目内 data 目录，随后“重启”（新建 Store）复核一致。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../src/core/store.ts";
import { bettiAt, representativeCycle } from "../src/core/persistence.ts";
import { bruteBetti, mstMergeScales } from "../src/core/crosscheck.ts";
import { barsToCsv } from "../src/core/exporters.ts";

const dataDir = resolve("data");
rmSync(resolve(dataDir, "ph.sqlite"), { force: true });
mkdirSync(dataDir, { recursive: true });

const square = [
  { id: "v0", coord: [0, 0] },
  { id: "v1", coord: [1, 0] },
  { id: "v2", coord: [1, 1] },
  { id: "v3", coord: [0, 1] },
];

const store = new Store(resolve(dataDir, "ph.sqlite"));
store.importVersion("unit-square", square);

console.log("== 1) 完整尺度 maxScale = sqrt(2) ==", Math.SQRT2.toFixed(6));
const full = store.runAnalysis("unit-square", Math.SQRT2, { keepZeroLength: false });
for (const bar of full.result.bars) {
  console.log(
    `H${bar.dim}  [${bar.birth}, ${bar.death === null ? "右删失" : bar.death.toFixed(6)})` +
      `  出生单纯形=${bar.birthSimplex} 死亡单纯形=${bar.deathSimplex ?? "-"}`,
  );
}
const h1 = full.result.bars.find((b) => b.dim === 1 && !b.zeroLength)!;
console.log("尺度 1 的 Betti:", bettiAt(full.result, 1), " 穷举秩核对:", bruteBetti(square, 1));
console.log("尺度 sqrt(2) 的 Betti:", bettiAt(full.result, Math.SQRT2), " 穷举秩核对:", bruteBetti(square, Math.SQRT2));
const cycle = representativeCycle(full.result, h1.birthSimplex)!;
console.log("代表环边:", cycle.edges, " GF(2) 边界为零:", cycle.boundaryZero);
console.log(cycle.explanation);

const mst = mstMergeScales(square, Math.SQRT2);
console.log("MST 合并尺度(独立核对 H0 死亡):", mst.merges.map((x) => x.toFixed(6)));

console.log("\n== 2) 截断 maxScale = 1.2（低于 sqrt(2)）==");
const cut = store.runAnalysis("unit-square", 1.2, {});
const cutH1 = cut.result.bars.find((b) => b.dim === 1)!;
console.log("H1 条带:", { birth: cutH1.birth, death: cutH1.death, censored: cutH1.censored });
console.log(representativeCycle(cut.result, cutH1.birthSimplex)!.explanation);

writeFileSync(resolve(dataDir, "barcodes-full.csv"), barsToCsv(full.result));

console.log("\n== 3) 重启复核：关闭并重新打开 SQLite ==");
store.close();
const reopened = new Store(resolve(dataDir, "ph.sqlite"));
const analyses = reopened.listAnalyses("unit-square");
console.log("历史分析数量（旧分析未被覆盖）:", analyses.length);
const reloaded = reopened.getResult(analyses[0]!.id);
console.log(
  "重载后 H1:",
  reloaded.bars
    .filter((b) => b.dim === 1 && !b.zeroLength)
    .map((b) => `[${b.birth}, ${b.death === null ? "右删失" : b.death.toFixed(6)})`),
);
reopened.close();
console.log("\n演示完成。CSV 已导出到 data/barcodes-full.csv");
