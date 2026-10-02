import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ComputeResult, Point } from "./types.ts";
import { buildResult } from "./persistence.ts";

export interface VersionRecord {
  name: string;
  dimension: number;
  pointCount: number;
  createdAt: string;
}

export interface AnalysisRecord {
  id: number;
  versionName: string;
  maxScale: number;
  keepZeroLength: number;
  limitsJson: string;
  createdAt: string;
  aborted: number;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const full = resolve(dbPath);
    mkdirSync(dirname(full), { recursive: true });
    this.db = new DatabaseSync(full);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS versions (
        name TEXT PRIMARY KEY,
        dimension INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS points (
        version_name TEXT NOT NULL,
        point_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        coord TEXT NOT NULL,
        PRIMARY KEY (version_name, point_id),
        FOREIGN KEY (version_name) REFERENCES versions(name)
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_name TEXT NOT NULL,
        max_scale REAL NOT NULL,
        keep_zero_length INTEGER NOT NULL,
        limits_json TEXT NOT NULL,
        aborted INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (version_name) REFERENCES versions(name)
      );
      CREATE TABLE IF NOT EXISTS analysis_results (
        analysis_id INTEGER PRIMARY KEY,
        result_json TEXT NOT NULL,
        FOREIGN KEY (analysis_id) REFERENCES analyses(id)
      );
    `);
  }

  /** 导入点云版本。已存在同名版本时显式报错，不覆盖。 */
  importVersion(name: string, points: Point[]): VersionRecord {
    if (points.length === 0) throw new Error("点云不能为空");
    const dim = points[0]!.coord.length;
    const exists = this.db.prepare("SELECT name FROM versions WHERE name = ?").get(name);
    if (exists) throw new Error(`版本 ${name} 已存在；不覆盖旧版本，请使用新名称`);
    const createdAt = new Date().toISOString();
    const tx = this.db.prepare(
      "INSERT INTO versions(name, dimension, created_at) VALUES (?,?,?)",
    );
    tx.run(name, dim, createdAt);
    const ins = this.db.prepare(
      "INSERT INTO points(version_name, point_id, ord, coord) VALUES (?,?,?,?)",
    );
    points.forEach((p, i) => ins.run(name, p.id, i, JSON.stringify(p.coord)));
    return { name, dimension: dim, pointCount: points.length, createdAt };
  }

  listVersions(): VersionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT v.name AS name, v.dimension AS dimension, v.created_at AS createdAt,
                COUNT(p.point_id) AS pointCount
         FROM versions v LEFT JOIN points p ON p.version_name = v.name
         GROUP BY v.name ORDER BY v.created_at`,
      )
      .all() as Array<{ name: string; dimension: number; createdAt: string; pointCount: number }>;
    return rows.map((r) => ({
      name: r.name,
      dimension: r.dimension,
      pointCount: r.pointCount,
      createdAt: r.createdAt,
    }));
  }

  getPoints(name: string): Point[] {
    const rows = this.db
      .prepare("SELECT point_id, coord, ord FROM points WHERE version_name = ? ORDER BY ord")
      .all(name) as Array<{ point_id: string; coord: string; ord: number }>;
    if (rows.length === 0) throw new Error(`版本 ${name} 不存在`);
    return rows.map((r) => ({ id: r.point_id, coord: JSON.parse(r.coord) as number[] }));
  }

  /** 执行持久计算并以新记录追加保存阈值快照，绝不覆盖旧分析。 */
  runAnalysis(
    versionName: string,
    maxScale: number,
    opts: { keepZeroLength?: boolean; limits?: ComputeResult["limits"] } = {},
  ): { analysis: AnalysisRecord; result: ComputeResult } {
    const points = this.getPoints(versionName);
    const keepZeroLength = opts.keepZeroLength ?? false;
    const result = buildResult(versionName, points, maxScale, opts.limits, keepZeroLength);
    const createdAt = result.createdAt;
    const info = this.db
      .prepare(
        `INSERT INTO analyses(version_name, max_scale, keep_zero_length, limits_json, aborted, created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        versionName,
        maxScale,
        keepZeroLength ? 1 : 0,
        JSON.stringify(result.limits),
        result.aborted ? 1 : 0,
        createdAt,
      );
    const id = Number(info.lastInsertRowid);
    this.db
      .prepare("INSERT INTO analysis_results(analysis_id, result_json) VALUES (?,?)")
      .run(id, JSON.stringify(result));
    return { analysis: this.getAnalysis(id)!, result };
  }

  listAnalyses(versionName?: string): AnalysisRecord[] {
    const rows = versionName
      ? (this.db
          .prepare(
            `SELECT id, version_name AS versionName, max_scale AS maxScale,
                    keep_zero_length AS keepZeroLength, limits_json AS limitsJson,
                    created_at AS createdAt, aborted
             FROM analyses WHERE version_name = ? ORDER BY id`,
          )
          .all(versionName) as unknown as AnalysisRecord[])
      : (this.db
          .prepare(
            `SELECT id, version_name AS versionName, max_scale AS maxScale,
                    keep_zero_length AS keepZeroLength, limits_json AS limitsJson,
                    created_at AS createdAt, aborted
             FROM analyses ORDER BY id`,
          )
          .all() as unknown as AnalysisRecord[]);
    return rows;
  }

  getAnalysis(id: number): AnalysisRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, version_name AS versionName, max_scale AS maxScale,
                keep_zero_length AS keepZeroLength, limits_json AS limitsJson,
                created_at AS createdAt, aborted
         FROM analyses WHERE id = ?`,
      )
      .get(id) as AnalysisRecord | undefined;
    return row ?? null;
  }

  getResult(id: number): ComputeResult {
    const row = this.db
      .prepare("SELECT result_json AS j FROM analysis_results WHERE analysis_id = ?")
      .get(id) as { j: string } | undefined;
    if (!row) throw new Error(`分析 ${id} 不存在`);
    return JSON.parse(row.j) as ComputeResult;
  }

  close(): void {
    this.db.close();
  }
}
