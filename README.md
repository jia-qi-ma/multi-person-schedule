# 多人时间表

一个用来算「全员共同空闲时段」的练习项目：各人录入自己的忙碌时段，页面算出所有人都空着的时间。

## 能做什么

- 添加成员（名字不能重复，颜色由后端从调色板里分配）
- 给某个成员录一段忙碌（同一天、起止完全相同会被挡住，防止误录两次）
- 删除忙碌；删除成员时会**连带删掉他名下的所有忙碌**（不可逆，删前会确认）
- 切换日期，看那一天谁忙、哪段时间大家都有空

## 跑起来

前置两样：

- **Node.js**（本机默认的 v22 即可）
- **PostgreSQL 19**，作为本机服务跑在 5432 端口

### 第一次准备（只做一次）

**1. 建库**

```bash
psql -U postgres -c "CREATE DATABASE scheduler;"
```

会提示输密码，输入时屏幕不显示任何字符，这是正常的。

**2. 建表并灌入两条基线数据**

```bash
cd backend
psql -U postgres -d scheduler -f db/schema.sql
```

脚本是幂等的：每次都先 `DROP TABLE` 再重建，跑完数据回到两条基线（张三、李四各一条忙碌）。

**3. 配置连接串**

```powershell
Copy-Item .env.example .env
```

然后编辑 `backend/.env`，把密码换成安装 PostgreSQL 时给 `postgres` 设的那个。

`.env` 已被 `.gitignore` 挡住，不会进仓库；入库的只有不含密码的 `.env.example`。
如果密码里有 `@ : / # %`，连接串会被解析错位，需要先做 URL 编码（`@` 写成 `%40`）。

### 每次开发

需要**两个终端窗口**：一个跑后端，一个跑前端。两个都别关，要停服务按 `Ctrl+C`。

**窗口 A（后端）**

```bash
cd backend
npm install
npm run dev
```

看到 `backend 已启动：http://localhost:3001` 就对了。

**窗口 B（前端）**

```bash
cd frontend
npm install
npm run dev
```

终端会显示一个本地地址（通常是 http://localhost:5173/），用浏览器打开它。

**两个容易踩的点：**

- 启动窗口 A 之前，**PostgreSQL 服务必须是跑着的**（Windows 服务名 `postgresql-x64-19`，默认开机自启）。
- 改了 `backend/` 里的代码后，**窗口 A 必须 `Ctrl+C` 重启**，否则跑的还是内存里的老版本。

## 怎么算跑对了

页面刚打开时（日期默认 2026-11-15）应该是：

- 一行说明：`2026-11-15 · 2 人 · 最短 30 分钟 · 缓冲 15 分钟`
- 成员：张三、李四
- 忙碌：张三 09:00–11:00 组会，李四 10:00–12:00 实验课
- 两段空闲：`08:00 – 08:45（45 分钟）`、`12:15 – 22:00（585 分钟）`

再走四步，四步都对就说明前后端真的通了：

1. 给张三录 14:00–15:00 → 空闲变三段（45 / 90 / 405 分钟）
2. 同一条再录一次 → 提示「这一段忙碌已经录过了」，列表条数不变
3. 删掉这条 → 空闲恢复两段
4. 日期改成 2026-11-16 → 空闲变成一整天（840 分钟），忙碌列表显示「这一天还没有记录」

想确认数据真的来自数据库：

```bash
psql -U postgres -d scheduler -c "SELECT count(*) FROM events;"
```

页面上录一条，这个数字会跟着变；重启后端也不会归零（不像内存版，一重启就回到两条）。
中文在 Windows 终端里可能显示成乱码，那是终端编码问题，不是数据坏了。

## 接口

七个接口全部实现在 `backend/src/index.js`，字段形状以 `shared/types.ts`（契约 v1.2）为准。

| 方法   | 路径                | 干什么                       |
| ------ | ------------------- | ---------------------------- |
| GET    | `/api/users`        | 成员列表                     |
| POST   | `/api/users`        | 添加成员                     |
| DELETE | `/api/users/:id`    | 删成员（连带删他的忙碌）     |
| GET    | `/api/events?date=` | 某一天的忙碌记录（带成员信息）|
| POST   | `/api/events`       | 录一段忙碌                   |
| DELETE | `/api/events/:id`   | 删一段忙碌                   |
| GET    | `/api/free-slots`   | 算某一天的共同空闲           |

失败时 body 形状统一是 `{ success: false, error, code }`：`error` 是给人看的中文说明，`code` 是稳定错误码（如 `DUPLICATE_EVENT`）。前端按 `code` 分支，读不到就只显示 `error`。

## 数据从哪来

页面请求 `/api/free-slots?date=<选中的日期>` → vite 开发服务器转发到 `localhost:3001`
→ 后端在 `backend/src/data.js` 里发 SQL，从 PostgreSQL 取那天的忙碌记录
→ `backend/src/freeSlots.js` 算并集、扣缓冲、筛时长 → 按契约返回。

几处约定：

- **连接只有一处**：`backend/src/db.js`，密码从 `backend/.env` 读，代码里没有任何明文密码。
- **SQL 只有一处**：`backend/src/data.js`。想换表结构只改这里和 `db/schema.sql`。
- **`freeSlots.js` 不知道数据存在哪**：它收一个数组、返回一个数组，纯函数，所以换存储时它一个字没改。
- **日期不在页面里写死**：`main.js` 每次发请求前现读日期框的值，所以切日期不用刷新页面。
- **契约是唯一来源**：字段形状以 `shared/types.ts` 为准，两边都照它写。
- `shared/mock/` 的两份假响应保留着：后端自测、页面测试都能拿它当样例，不是废文件。

### 换存储时改了什么

从内存数组换成 PostgreSQL，实际改动只有：

| 文件 | 改动 |
| --- | --- |
| `src/db.js` | 新增：连接池 + 读 `.env` |
| `src/data.js` | 重写：数组操作 → SQL，函数全部变 `async` |
| `src/index.js` | 只加 `async` / `await`，路由、校验、错误码一个字没动 |
| `src/freeSlots.js` | **零改动** |
| `frontend/` | **零改动** |

`await` 是唯一挡不住的穿透：内存是同步的，数据库是异步的，调用处必须跟着变成 `async`。这不是分层没分对，是语言层面的必然。

## 目录

- `shared/` — 接口契约 + Mock 数据，前后端共用同一份，别复制
- `frontend/` — 页面（vite）。所有接口调用都在 `src/main.js`，没有别的请求散落在别处
- `backend/` — 接口（express）
  - `src/index.js` — 路由、校验、错误码（管网络）
  - `src/data.js` — 存取，写 SQL（管数据）
  - `src/freeSlots.js` — 算共同空闲（管算法，纯函数）
  - `src/db.js` — 数据库连接池（管连接）
  - `db/schema.sql` — 表结构、约束、基线数据

## 常见问题

**`psql -f db/schema.sql` 报「编码 GBK 中字节序列…」**
SQL 文件是 UTF-8，而 psql 在中文 Windows 上默认按 GBK 读。执行前先声明：

```powershell
$env:PGCLIENTENCODING="UTF8"
psql -U postgres -d scheduler -f db/schema.sql
```

**后端报 `password authentication failed for user "postgres"`**
`.env` 里的密码和数据库里的不一致。改库里的密码：`psql -U postgres -d scheduler` 进去后敲 `\password postgres`，输两遍新密码（都不显示）。

**页面提示「连不上后端」**
窗口 A 没在跑，或者改了后端代码没重启。先看窗口 A 还在不在。

**`psql` 里中文显示成乱码**
终端编码问题，不是数据坏了：`chcp 65001` 之后再查。

## 规则速览

- 共同空闲 = 可安排范围 − 全员忙碌时段的并集
- 默认范围 08:00–22:00，最短可用 30 分钟，忙碌块前后各留 15 分钟缓冲
- 录忙碌时「同一人 + 同一天 + 起止完全相同」判为重复，事由不参与比较
- 详细规则见 `需求表.md` 和 `shared/types.ts`
