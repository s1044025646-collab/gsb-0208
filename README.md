# 点云持久同调与拓扑条形码分析后端

在 Windows 本地离线运行的小规模二维/三维点云持久同调（Persistent Homology）服务。
只提供 **REST API 与 CLI**，不含前端页面。使用 **TypeScript + Node.js + SQLite**，
不依赖 Docker、WSL、付费服务或任何在线 API，也**不调用任何现成持久同调库**：
Vietoris–Rips 过滤、GF(2) 边界矩阵、列约化、出生–死亡配对均为自行实现。

## 功能

- 点有唯一字符串编号与有限坐标（2D/3D）；**重复坐标的点保留各自编号，绝不静默合并**。
- 管理点云版本、距离尺度上限 `maxScale` 与计算配置（预算、零长度条带策略）。
- 自行构造至多二维的 Vietoris–Rips 过滤：
  - 顶点在尺度 0 出现；
  - 边在两点距离 `<= epsilon` 时出现，过滤值为距离；
  - 三角形在三条边都出现时出现，过滤值为最长边长度。
- 只计算 GF(2) 上的 **H0（连通分支）与 H1（一维孔洞）**。
- 平局规则（公开且稳定）：过滤值升序；同值时维度升序（**面先于余面**），
  同维度按顶点索引严格递增元组的字典序。点按 `(id, 坐标)` 稳定排序，
  **输入顺序不同不会改变正长度条形码**。
- 输出半开区间 `[birth, death)`、配对单纯形序号与任意尺度的 Betti 数。
- 零长度条带（`birth == death`）默认省略，可用 `keepZeroLength` 显式保留并标记。
- 一维特征可查询**出生时的一组代表边环**，并核验其 GF(2) 边界为零；
  若已死亡，说明它在死亡尺度如何被三角形边界填充。
- 达到 `maxScale` 仍存活的条带标记为 **右删失（censored）**，`death = null`：
  含义是“尚未计算到死亡”，**不宣称永久存在**。
- 公开点数、单纯形数量与矩阵预算（列加法次数）；超限时在计算前拒绝或以
  `aborted` 明确中止，**不会偷偷省略三角形去保留更多孔洞**。
- 独立交叉核验：
  - 最小生成树（Kruskal）核对 H0 的合并/死亡尺度；
  - 小矩阵 GF(2) 高斯消元穷举秩核对任意尺度 Betti 数。
- SQLite 持久化输入点云与每次分析的阈值快照，**同名版本不可覆盖、旧分析只追加**。
- JSON / CSV 导出（条形码、过滤结构、完整结果）。

## 环境要求

- Node.js **>= 24**（开发与实测版本：v25.5.0，npm 11.8.0）。
  使用 Node 内置模块 `node:sqlite`、`node:test` 与 TypeScript 类型擦除运行，
  无需原生编译工具链。
- Windows PowerShell。所有命令在项目根目录 `E:\GSB\0208\A` 下执行。

## 安装

```powershell
npm install
```

## 构建（TypeScript 类型检查）

```powershell
npm run build
```

说明：运行时使用 Node 原生类型擦除直接执行 `.ts`，`tsc` 作为类型检查门禁
（`noEmit`）。如需产出 JS，可去掉 `tsconfig.json` 中的 `noEmit` 并关闭
`allowImportingTsExtensions`。

## 测试

```powershell
npm test
```

覆盖：孤立点、两个点、三角形（零长度 H1）、重复坐标、两个簇、单位正方形
（必须有且仅有一条 `[1, sqrt(2))` 的 H1）、重排不变、整体缩放、
截断尺度右删失、预算超限拒绝/中止、MST 与穷举秩核验、API 全流程与重启复核。

## 一键演示

```powershell
npm run demo
```

演示：正方形孔洞在尺度 1 出生、在 `sqrt(2)` 被对角线三角形填充；
把 `maxScale` 截断到 1.2 时 H1 只能报告右删失；写入 SQLite 后“重启”重新打开复核；
并导出 `data/barcodes-full.csv`。

## 启动 HTTP 服务

```powershell
npm start
# 自定义端口与数据目录
$env:PCPORT='9000'; $env:PCDATA_DIR='E:\GSB\0208\A\data'; npm start
```

默认端口 `8787`，默认数据目录 `./data`（数据库文件 `data/ph.sqlite`）。

### API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/versions` | 导入点云版本（同名拒绝，不覆盖） |
| GET | `/versions` | 列出版本 |
| GET | `/versions/{name}/points` | 查看原始点（保留 id 与重复坐标） |
| POST | `/versions/{name}/analyses` | 运行持久计算并保存阈值快照 |
| GET | `/analyses?version={name}` | 列出历史分析（只追加，不覆盖） |
| GET | `/analyses/{id}` | 完整结果（条带、过滤、预算、环） |
| GET | `/analyses/{id}/filtration[?format=csv]` | 有序过滤结构 |
| GET | `/analyses/{id}/barcodes[?format=csv]` | 条形码（半开区间）与预算元信息 |
| GET | `/analyses/{id}/slice?scale=s` | 尺度 s 的 Betti 数（附穷举秩核验） |
| GET | `/analyses/{id}/cycles/{birthSimplex}` | H1 代表边环、GF(2) 边界核验与填充解释 |
| GET | `/analyses/{id}/crosscheck` | MST 合并尺度 vs H0 死亡尺度 |
| POST | `/compare` | 两个分析版本对比（body: `{"a":1,"b":2}`） |
| GET | `/analyses/{id}/export?kind=bars\|filtration\|json` | JSON/CSV 导出 |

导入 body 示例：

```json
{
  "name": "unit-square",
  "points": [
    { "id": "v0", "coord": [0, 0] },
    { "id": "v1", "coord": [1, 0] },
    { "id": "v2", "coord": [1, 1] },
    { "id": "v3", "coord": [0, 1] }
  ]
}
```

分析 body 示例：

```json
{ "maxScale": 1.4142135623730951, "keepZeroLength": false,
  "limits": { "maxPoints": 200, "maxSimplices": 2000000, "maxColumnAdditions": 200000000 } }
```

### curl/PowerShell 快速示例

```powershell
Invoke-RestMethod http://localhost:8787/health
$body = Get-Content data/sq.json -Raw
Invoke-RestMethod -Method Post http://localhost:8787/versions -ContentType 'application/json' -Body $body
Invoke-RestMethod -Method Post http://localhost:8787/versions/unit-square/analyses `
  -ContentType 'application/json' -Body '{"maxScale":1.4142135623730951}'
```

## CLI

```powershell
# 查看全部命令
node --experimental-strip-types src/cli.ts

# 导入（points.json 形如 {"points":[{"id":"p0","coord":[0,0]}, ...]}）
node --experimental-strip-types src/cli.ts import unit-square data/sq.json
node --experimental-strip-types src/cli.ts versions

# 计算（阈值快照会追加保存）
node --experimental-strip-types src/cli.ts analyze unit-square --scale 1.41421356
node --experimental-strip-types src/cli.ts analyze unit-square --scale 1.2 --keep-zero

# 条形码 / 过滤 / 尺度切片 / 代表环 / 交叉核验 / 对比 / 导出
node --experimental-strip-types src/cli.ts barcodes 1 --csv
node --experimental-strip-types src/cli.ts filtration 1
node --experimental-strip-types src/cli.ts slice 1 --scale 1.1
node --experimental-strip-types src/cli.ts cycle 1 --birth 7
node --experimental-strip-types src/cli.ts crosscheck 1
node --experimental-strip-types src/cli.ts compare 1 2
node --experimental-strip-types src/cli.ts export 1 --kind bars --out data/bars.csv
```

也可用 `npm run cli -- <参数>`。设置 `$env:PCDATA_DIR` 可更换数据目录。

## 算法与语义约定

- **边界矩阵（GF(2)）**：列为单纯形，行为其面；边列含两个顶点位，
  三角形列含三条边位。使用 bigint 位集表示，左到右标准列约化（pivot 消元）。
  同时维护每列由哪些原始边列 XOR 而成，使 H1 出生列直接得到闭合边环代表链。
- **配对**：消元后，pivot 行为 `r`、列为 `j` 给出配对 `(r, j)`；
  出生面的维度决定 H0/H1。未配对的顶点=存活分支，未配对的边=存活孔洞（右删失）。
- **半开区间**：`birth <= scale < death` 计入该尺度 Betti；故正方形在
  `scale=1` 时 `b1=1`，在 `scale=sqrt(2)` 时 `b1=0`。
- **零长度条带**：如等边三角形在同尺度成环又被填充；默认省略，
  `keepZeroLength=true` 时保留并置 `zeroLength=true`。
- **预算**：默认 `maxPoints=200`、`maxSimplices=2,000,000`、
  `maxColumnAdditions=200,000,000`，均可在每次分析时覆盖。

## 限制与合理假设

- 仅 2D/3D 点、仅 H0/H1、仅 Vietoris–Rips，不做高维同调、Witness/Alpha 复杂形或绘图。
- 面向小规模点云；复杂度对点数为立方量级（三角形 O(n³)），超限即明确拒绝/中止。
- 距离为欧氏距离；坐标必须全部有限（拒绝 `NaN`/`Infinity`）。
- 同尺度数值比较使用精确 `<=`；版本对比默认容差 1e-9。
- `node:sqlite` 在当前 Node 版本会打印一条 ExperimentalWarning，不影响功能。
