# Windows 本地点云持久同调与拓扑条形码后端

这是一个只包含 API 与 CLI 的离线后端，用 TypeScript、Node.js 和 SQLite 实现小规模二维或三维点云的 Vietoris–Rips 持久同调分析。不使用 Docker、WSL、外部在线 API 或现成持久同调库。

## 环境要求

- Windows 本地 PowerShell。
- Node.js 22.5 或更新版本；已在 Node.js 25.5 验证。
- SQLite 使用 Node 内置的 `node:sqlite`，无需 C++ 编译工具链。

## 快速开始

```powershell
npm install
npm run build
npm test
npm start
```

默认服务地址为 `http://localhost:3000`，默认数据库为项目内 `data/pointcloud-ph.sqlite`。

自定义端口和数据目录：

```powershell
$env:PORT="3217"
$env:DATA_DIR="data"
npm start
```

完整 Windows 演示：

```powershell
npm run build
npm run demo
```

演示会展示单位正方形：四条长度 1 的边在尺度 1 形成一个 H1 孔洞；两个对角线长度为 `sqrt(2)`，对应三角形在 `sqrt(2)` 进入并填充孔洞。截断为 `maxEpsilon=1` 时，不会声称孔洞永久存在，而是标记为 `right-censored`。

## 输入约定

点必须有唯一字符串编号和有限的二维 `x,y` 坐标；可提供有限的三维 `z`。重复坐标不会合并，两个点仍保留各自编号。

```json
[
  { "id": "a", "x": 0, "y": 0 },
  { "id": "b", "x": 1, "y": 0 },
  { "id": "c", "x": 1, "y": 1 },
  { "id": "d", "x": 0, "y": 1 }
]
```

## 持久同调算法

1. 先按点编号做稳定的内部排序，保证重排输入不改变正长度条形码。
2. 顶点都在尺度 0 进入。
3. 边在欧氏距离 `d <= maxEpsilon` 时以 `d` 进入。
4. 三角形只在三条边都存在时进入，过滤值为三条边的最大长度；不会为了保留孔洞偷偷省略三角形。
5. 过滤排序使用 `(过滤值, 维度, 顶点编号升序)`。相同过滤值下面先于边、边先于三角形，这是公开固定的平局规则。
6. 自行构造至多二维单纯形边界矩阵：顶点列为空，边列含两个端点，三角形列含三条边。
7. 在 GF(2) 上执行稀疏列约化，使用最低非零 pivot 完成出生–死亡配对。
8. 区间统一为半开区间 `[birth, death)`：`epsilon = birth` 存活，`epsilon = death` 已死亡。
9. 默认保留零长度条；可设置 `includeZeroLength:false` 省略。省略零长度条不会影响 Betti 数。
10. 达到用户设定 `maxEpsilon` 仍没有死亡的条带标记为 `right-censored`，`death:null`；这表示“尚未计算到死亡”，不是数学上的永久存在。

## 预算与拒绝

默认预算：

- `maxPoints = 120`
- `maxSimplices = 120000`
- `maxMatrixEntries = 240000`

系统在构造后、约化前检查点数、单纯形数和初始矩阵非零项；约化过程中若 GF(2) 填充导致当前非零项超过预算，也会明确中止且不保存分析。分析结果公开点数、顶点数、边数、三角形数、单纯形总数、预算、实际峰值非零项和已约化列数。

## HTTP API

- `GET /health`：健康检查。
- `POST /clouds`：导入点云；同名再次导入自动生成新版本，不覆盖旧版本。
- `GET /clouds`：列出点云版本。
- `GET /clouds/{id}`：查看点云及点编号。
- `POST /clouds/{id}/analyses`：保存阈值快照并运行分析。
- `GET /analyses?cloudId=...`：列出旧分析，不覆盖。
- `GET /analyses/{id}`：完整配置与结果。
- `GET /analyses/{id}/filtration`：查看过滤结构。
- `GET /analyses/{id}/barcodes`：条形码。
- `GET /analyses/{id}/slice?epsilon=...`：给定尺度的 H0/H1 Betti 数。
- `GET /analyses/{id}/cycle?birthPointIds=a,b`：H1 出生代表边、GF(2) 边界核验和死亡时填充三角形。
- `GET /analyses/{id}/verify?epsilon=...`：用独立最小生成树核对 H0 合并尺度，并用小矩阵 GF(2) 穷举秩核对 Betti 数。
- `GET /analyses/{id}/export?format=json|csv`：JSON 或 CSV 导出。
- `POST /compare`：比较两个分析的条形码签名。
- `POST /preview`：不落库预览计算。

示例：

```powershell
$cloud = Invoke-RestMethod -Method Post -Uri http://localhost:3000/clouds -ContentType 'application/json; charset=utf-8' -Body (@{
  name = 'square'
  points = Get-Content examples/square.json -Raw
} | ConvertTo-Json)

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/clouds/$($cloud.cloud.id)/analyses" -ContentType 'application/json' -Body '{"maxEpsilon":1.4142135623730951}'
Invoke-RestMethod 'http://localhost:3000/analyses/1/verify?epsilon=1.4142135623730951'
```

## CLI

```powershell
node dist/cli.js import square examples/square.json --db data/app.sqlite
node dist/cli.js analyze 1 --max-epsilon 1.4142135623730951 --db data/app.sqlite
node dist/cli.js barcodes 1 --db data/app.sqlite
node dist/cli.js filtration 1 --db data/app.sqlite
node dist/cli.js slice 1 1 --db data/app.sqlite
node dist/cli.js cycle 1 a,b --db data/app.sqlite
node dist/cli.js export 1 csv barcodes.csv --db data/app.sqlite
node dist/cli.js compare 1 2 --db data/app.sqlite
node dist/cli.js list --db data/app.sqlite
```

省略零长度条：

```powershell
node dist/cli.js analyze 1 --max-epsilon 2 --omit-zero --db data/app.sqlite
```

## 代表环与填充说明

有限 H1 的代表边来自死亡时维护的 GF(2) 二单纯形链边界。它在出生尺度是闭合一维环，每个顶点出现偶数次，因此边界为 0。到死亡尺度，同一组三角形边界等于该环，说明环变成二维曲面边界而被填充。

右删失 H1 在用户截断范围内没有死亡二链；系统用出生前生成树路径与出生边构造闭合代表环，但只报告“尚未计算到死亡”。

## 测试

`npm test` 覆盖：

- 孤立点、两个点、三角形、重复坐标、两个簇、单位正方形。
- 正方形正长度条带 `[1,sqrt(2))`。
- 独立 MST 核对 H0 合并尺度。
- 小矩阵 GF(2) 秩公式 `Betti0=V-rank(d1)`、`Betti1=E-rank(d1)-rank(d2)`。
- 输入重排不变和整体坐标缩放。
- 截断尺度的右删失语义。
- SQLite 关闭重启后读取阈值快照与旧分析。
- 点数和矩阵预算拒绝。

## 已知限制

- 只计算 H0 和 H1，不计算 H2 或更高维。
- 暴力枚举点对和三点组，复杂度约为 `O(n^3)`，默认面向小规模教学和验证数据。
- `node:sqlite` 在当前 Node 版本会输出 experimental warning，但 API 已随安装的 Node 本地提供。
- 不提供绘图页面或前端，仅返回 JSON/CSV。
