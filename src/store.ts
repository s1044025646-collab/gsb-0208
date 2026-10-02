import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ComputeConfig, Point } from "./types.js";

export type StoredCloud = {
  id: number;
  name: string;
  version: number;
  created_at: string;
  point_count: number;
};

export type StoredAnalysis = {
  id: number;
  cloud_id: number;
  version: number;
  created_at: string;
  config_json: string;
  result_json: string;
};

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS point_clouds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, version)
      );
      CREATE TABLE IF NOT EXISTS points (
        cloud_id INTEGER NOT NULL REFERENCES point_clouds(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        point_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL,
        PRIMARY KEY(cloud_id, point_id)
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cloud_id INTEGER NOT NULL REFERENCES point_clouds(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        config_json TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_points_cloud ON points(cloud_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_analyses_cloud ON analyses(cloud_id, version);
    `);
  }

  insertCloud(name: string, points: Point[]): StoredCloud {
    const latest = this.db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM point_clouds WHERE name = ?").get(name) as { v: number };
    const version = latest.v + 1;
    const info = this.db.prepare("INSERT INTO point_clouds(name, version) VALUES (?, ?)").run(name, version);
    const cloudId = Number(info.lastInsertRowid);
    const insert = this.db.prepare("INSERT INTO points(cloud_id, ordinal, point_id, x, y, z) VALUES (?, ?, ?, ?, ?, ?)");
    points.forEach((point, ordinal) => insert.run(cloudId, ordinal, point.id, point.x, point.y, point.z ?? null));
    return this.getCloud(cloudId)!;
  }

  getCloud(id: number): StoredCloud | null {
    return (this.db.prepare("SELECT id,name,version,created_at, (SELECT COUNT(*) FROM points WHERE cloud_id=point_clouds.id) AS point_count FROM point_clouds WHERE id=?").get(id) as StoredCloud) ?? null;
  }

  findCloudVersion(name: string, version: number): StoredCloud | null {
    return (this.db.prepare("SELECT id,name,version,created_at, (SELECT COUNT(*) FROM points WHERE cloud_id=point_clouds.id) AS point_count FROM point_clouds WHERE name=? AND version=?").get(name, version) as StoredCloud) ?? null;
  }

  listClouds(): StoredCloud[] {
    return this.db.prepare("SELECT id,name,version,created_at, (SELECT COUNT(*) FROM points WHERE cloud_id=point_clouds.id) AS point_count FROM point_clouds ORDER BY name, version").all() as StoredCloud[];
  }

  getPoints(cloudId: number): Point[] {
    return (this.db.prepare("SELECT point_id AS id, x, y, z FROM points WHERE cloud_id=? ORDER BY ordinal").all(cloudId) as Point[]).map((point) => point.z === null ? { id: point.id, x: point.x, y: point.y } : point);
  }

  saveAnalysis(cloudId: number, config: ComputeConfig, result: unknown): StoredAnalysis {
    const cloud = this.getCloud(cloudId);
    if (!cloud) throw new Error("点云不存在");
    const info = this.db.prepare("INSERT INTO analyses(cloud_id, version, config_json, result_json) VALUES (?, ?, ?, ?)")
      .run(cloudId, cloud.version, JSON.stringify(config), JSON.stringify(result));
    return this.getAnalysis(Number(info.lastInsertRowid))!;
  }

  getAnalysis(id: number): StoredAnalysis | null {
    return (this.db.prepare("SELECT id,cloud_id,version,created_at,config_json,result_json FROM analyses WHERE id=?").get(id) as StoredAnalysis) ?? null;
  }

  listAnalyses(cloudId?: number): StoredAnalysis[] {
    if (cloudId === undefined) return this.db.prepare("SELECT id,cloud_id,version,created_at,config_json,result_json FROM analyses ORDER BY id").all() as StoredAnalysis[];
    return this.db.prepare("SELECT id,cloud_id,version,created_at,config_json,result_json FROM analyses WHERE cloud_id=? ORDER BY id").all(cloudId) as StoredAnalysis[];
  }

  close() { this.db.close(); }
}
