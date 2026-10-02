import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { createApp } from "../src/server/http.ts";
import type { Server } from "node:http";

let dir: string;
let store: Store;
let server: Server;
let base: string;

const square = [
  { id: "0", coord: [0, 0] },
  { id: "1", coord: [1, 0] },
  { id: "2", coord: [1, 1] },
  { id: "3", coord: [0, 1] },
];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "ph-test-"));
  store = new Store(join(dir, "ph.sqlite"));
  await new Promise<void>((resolvePromise) => {
    server = createApp(store).listen(0, () => resolvePromise());
  });
  const addr = server.address();
  if (typeof addr === "object" && addr) base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function j(path: string, init?: RequestInit) {
  const res = await fetch(base + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test("健康检查", async () => {
  const r = await j("/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("完整 API 流程：导入、重复版本拒绝、分析、条形码、切片、环、交叉核验、持久化", async () => {
  const imp = await j("/versions", { method: "POST", body: JSON.stringify({ name: "sq", points: square }) });
  assert.equal(imp.status, 201);

  const dup = await j("/versions", { method: "POST", body: JSON.stringify({ name: "sq", points: square }) });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /不覆盖/);

  const an = await j("/versions/sq/analyses", {
    method: "POST",
    body: JSON.stringify({ maxScale: Math.SQRT2 }),
  });
  assert.equal(an.status, 201);
  const id = an.body.analysis.id;
  const bars = an.body.result.bars.filter((b: { dim: number }) => b.dim === 1);
  assert.equal(bars.length, 1);
  assert.ok(Math.abs(bars[0].death - Math.SQRT2) < 1e-12);

  const slice = await j(`/analyses/${id}/slice?scale=1`);
  assert.deepEqual(slice.body.betti0, 1);
  assert.deepEqual(slice.body.betti1, 1);
  assert.deepEqual(slice.body.bruteRankCheck, { betti0: 1, betti1: 1 });

  const cycle = await j(`/analyses/${id}/cycles/${bars[0].birthSimplex}`);
  assert.equal(cycle.body.cycle.boundaryZero, true);
  assert.equal(cycle.body.cycle.edges.length, 4);

  const cross = await j(`/analyses/${id}/crosscheck`);
  assert.equal(cross.body.mstAgreesWithH0, true);

  const csv = await fetch(base + `/analyses/${id}/barcodes?format=csv`);
  const csvText = await csv.text();
  assert.match(csvText, /dim,birth,death/);

  // 再跑一个截断分析，确认旧分析不被覆盖。
  const cut = await j("/versions/sq/analyses", { method: "POST", body: JSON.stringify({ maxScale: 1.2 }) });
  assert.notEqual(cut.body.analysis.id, id);
  const list = await j("/analyses?version=sq");
  assert.equal(list.body.analyses.length, 2);

  const cmp = await j("/compare", {
    method: "POST",
    body: JSON.stringify({ a: id, b: cut.body.analysis.id }),
  });
  assert.equal(cmp.status, 200);
  assert.ok(cmp.body.comparison.onlyInB.some((bar: { censored: boolean }) => bar.censored));
});

test("重启后复核：新建 Store 仍能读到旧输入与结果", async () => {
  const store2 = new Store(join(dir, "ph.sqlite"));
  const versions = store2.listVersions();
  assert.ok(versions.some((v) => v.name === "sq"));
  const analyses = store2.listAnalyses("sq");
  assert.equal(analyses.length >= 1, true);
  const result = store2.getResult(analyses[0]!.id);
  assert.ok(result.bars.some((b) => b.dim === 1));
  store2.close();
});
