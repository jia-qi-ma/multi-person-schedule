# 多人时间表

一个用来算「全员共同空闲时段」的练习项目：各人登录后录入自己的忙碌时段，页面算出所有人都空着的时间。

## 能做什么

- **注册账号**（名字不能重复，颜色由后端从调色板里分配），注册后即可登录
- 登录后**录自己的忙碌**（同一天、起止完全相同会被挡住，防止误录两次）
- 删除自己的忙碌；**注销账号**时会连带删掉名下所有忙碌（不可逆，会二次确认）
- 切换日期，看那一天谁忙、哪段时间大家都有空
- 成员列表和空闲时段**不需要登录也能看**，但只有本人的记录才有删除按钮

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
基线账号的密码也写在这个脚本里，重跑之后仍是 `zhangsan123` / `lisi123`，**你自己注册的账号会被清掉**。

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

打开页面先看到**登录框**，下面写着种子账号：`张三 / zhangsan123`、`李四 / lisi123`（仅本机演示用）。

用张三登录后，日期默认 2026-11-15，界面上应该是：

- 顶栏：`当前用户：张三` 和登出按钮
- 一行说明：`2026-11-15 · 2 人 · 最短 30 分钟 · 缓冲 15 分钟`
- 成员：张三、李四（张三名下有「注销」，李四那行没有）
- 忙碌：张三 09:00–11:00 组会，李四 10:00–12:00 实验课
- 两段空闲：`08:00 – 08:45（45 分钟）`、`12:15 – 22:00（585 分钟）`

再走四步，四步都对就说明前后端和登录都通了：

1. 录一段 14:00–15:00 → 空闲变三段（45 / 90 / 405 分钟）
2. 同一条再录一次 → 提示「这一段忙碌已经录过了」，列表条数不变
3. 删掉这条 → 空闲恢复两段
4. 日期改成 2026-11-16 → 空闲变成一整天（840 分钟），忙碌列表显示「这一天还没有记录」

**再验一次权限**（这是 v2.0 的重点）：

1. 点登出 → 回到登录框，列表清空；
2. 换 `李四 / lisi123` 登录 → 顶栏变李四，**张三那条记录没有删除按钮**；
3. 在浏览器 Console 里绕过界面直接发请求：
   ```js
   fetch('/api/events/<张三那条的id>', { method: 'DELETE' }).then(r => r.json()).then(console.log)
   ```
   应该返回 `403 FORBIDDEN`。**前端不给按钮只是体验，后端回 403 才是权限。**

想确认数据真的来自数据库：

```bash
psql -U postgres -d scheduler -c "SELECT count(*) FROM events;"
```

页面上录一条，这个数字会跟着变；重启后端也不会归零。
中文在 Windows 终端里可能显示成乱码，那是终端编码问题，不是数据坏了。

## 接口

十个接口全部实现在 `backend/src/index.js`，字段形状以 `shared/types.ts`（契约 **v2.0**）为准。

| 方法   | 路径                | 要登录 | 干什么                           |
| ------ | ------------------- | ------ | -------------------------------- |
| POST   | `/api/register`     | 否     | 注册账号（名字 + 密码）           |
| POST   | `/api/login`        | 否     | 登录，成功后种下 cookie           |
| POST   | `/api/logout`       | 否     | 登出，销毁会话                    |
| GET    | `/api/me`           | 是     | 当前登录的是谁                    |
| GET    | `/api/users`        | 否     | 成员列表                          |
| DELETE | `/api/users/:id`    | 是     | 注销账号，**只能删自己**          |
| GET    | `/api/events?date=` | 否     | 某一天的忙碌记录（带成员信息）    |
| POST   | `/api/events`       | 是     | 录一段忙碌，归属由会话决定        |
| DELETE | `/api/events/:id`   | 是     | 删一段忙碌，**只能删自己的**      |
| GET    | `/api/free-slots`   | 否     | 算某一天的共同空闲                |

失败时 body 形状统一是 `{ success: false, error, code }`：`error` 是给人看的中文说明，`code` 是稳定错误码（如 `DUPLICATE_EVENT`）。前端按 `code` 分支，读不到就只显示 `error`。

**身份由 cookie 里的会话决定**，请求体里不再有 `userId`。老客户端如果还带着它，会收到 `400 UNKNOWN_FIELD` —— 这是故意的：宁可当场报错，也不要安静地把数据记到别人名下。

## 数据从哪来

页面请求 `/api/free-slots?date=<选中的日期>` → vite 开发服务器转发到 `localhost:3001`
→ 后端在 `backend/src/data.js` 里发 SQL，从 PostgreSQL 取那天的忙碌记录
→ `backend/src/freeSlots.js` 算并集、扣缓冲、筛时长 → 按契约返回。

几处约定：

- **连接只有一处**：`backend/src/db.js`，密码从 `backend/.env` 读，代码里没有任何明文密码。
- **SQL 只有一处**：`backend/src/data.js`。想换表结构只改这里和 `db/schema.sql`。
- **`freeSlots.js` 不知道数据存在哪**：它收一个数组、返回一个数组，纯函数，所以换存储时它一个字没改。
- **日期不在页面里写死**：`main.js` 每次发请求前现读日期框的值，所以切日期不用刷新页面。
- **会话只在后端内存里**：`backend/src/auth.js`，重启后端所有人掉线，需要重新登录。多实例部署要换成共享存储（Redis 或数据库表）。
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

### 加登录时改了什么

v2.0 是破坏性变更，改了接口签名，所以前端必须同步改、同一次发版：

| 位置 | 改动 |
| --- | --- |
| `db/schema.sql` | `users` 加 `password_hash`，种子账号带上 scrypt 哈希 |
| `src/auth.js` | 新增：密码哈希与校验、内存会话表、cookie 读写 |
| `src/index.js` | 三个认证路由 + `requireAuth` 中间件；四个写接口挂上；`POST /api/events` 从会话取身份 |
| `src/data.js` | 加 `findUserByName`、`findEventById`，`addUser` 收哈希 |
| `frontend/` | 拆出登录页、去掉 `userId`、401 统一切回登录框 |
| `src/freeSlots.js` | **零改动** |

## 目录

- `shared/` — 接口契约 + Mock 数据，前后端共用同一份，别复制
- `frontend/` — 页面（vite）。所有接口调用都在 `src/main.js`，没有别的请求散落在别处
- `backend/` — 接口（express）
  - `src/index.js` — 路由、校验、错误码（管网络）
  - `src/auth.js` — 密码哈希、会话表、cookie（管身份）
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

**登录后一刷新就退回登录框**
会话存在后端内存里，窗口 A 重启过就全失效了，重新登录即可。这不是 bug。

**`psql` 里中文显示成乱码**
终端编码问题，不是数据坏了：`chcp 65001` 之后再查。

## 规则速览

- 共同空闲 = 可安排范围 − 全员忙碌时段的并集
- 默认范围 08:00–22:00，最短可用 30 分钟，忙碌块前后各留 15 分钟缓冲
- 录忙碌时「同一人 + 同一天 + 起止完全相同」判为重复，事由不参与比较
- 身份由后端会话决定，请求体里的 `userId` 一律拒绝（`UNKNOWN_FIELD`）
- 没有角色：系统里不存在「删别人」这个动作，只能注销自己；也没有管理员
- 详细规则、授权表、已知未做项见 `shared/types.ts`
