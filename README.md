# 多人时间表

一个用来算「全员共同空闲时段」的练习项目：各人登录后录入自己的忙碌时段，页面算出所有人都空着的时间。

## 能做什么

- **注册账号**（名字不能重复，颜色由后端从调色板里分配），注册后即可登录
- 登录后**录自己的忙碌**（同一天、起止完全相同会被挡住，防止误录两次）
- 删除自己的忙碌；**注销账号**时会连带删掉名下所有忙碌（不可逆，会二次确认）
- **竖向时间轴**看一天：橙块是可用、灰块是忙碌、白缝是缓冲，高度按分钟等比，一眼看出哪段长
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

### 跑测试

算法有测试，**不需要数据库、也不需要后端在跑**，另开一个终端就行：

```bash
cd backend
npm test
```

六条用例，看到 `pass 6 / fail 0` 就对了，耗时几十毫秒。用的是 node 自带的 test runner，仓库里没有新增任何测试框架依赖。

它守的是 `freeSlots.js` 那三条规则：并集、缓冲从两边各扣、先扣缓冲再按最短时长筛。改了算法之后先跑它，比打开页面点一遍快得多 —— 页面一次只能给你看一种情况，而它一次跑六种。

**测不过怎么办**：终端里那条中文用例名就是线索，不用猜。想确认测试真的能拦住错，可以把 `freeSlots.js` 里 `b.start - bufferMinutes` 的 `- bufferMinutes` 删掉再跑一次，会红三条；看完记得加回去。

## 怎么算跑对了

打开页面先看到**登录框**，下面写着种子账号：`张三 / zhangsan123`、`李四 / lisi123`（仅本机演示用）。

用张三登录后，日期默认 2026-11-15，界面上应该是：

- 顶栏：`当前用户：张三` 和登出按钮
- 一行说明：`2026-11-15 · 2 人 · 最短 30 分钟 · 缓冲 15 分钟`
- 时间轴（08:00–22:00，每 2 小时一个刻度）三段颜色：
  - 橙 `08:00 – 08:45 · 45 分钟`
  - 灰 `2 人忙碌`（张三 09:00–11:00 和李四 10:00–12:00 重叠成一块；鼠标停上去看得到「张三、李四｜组会 / 实验课｜09:00 – 12:00」）
  - 橙 `12:15 – 22:00 · 585 分钟`（比上一条长得多的那根就是它）
- 成员：张三、李四（张三名下有「注销」，李四那行没有）
- 忙碌列表：张三 09:00–11:00 组会，李四 10:00–12:00 实验课

轴上的刻度是**时间**，块的高度是**时长**：45 分钟的块只有 33px 高，放不下字就只剩一条色带，这时候靠悬停看 `title`。这是刻意的取舍，不是没渲染完。

再走四步，四步都对就说明前后端和登录都通了：

1. 录一段 14:00–15:00 → 轴上多一块灰，它把原来的长橙块切成 45 / 90 / 405 分钟三段
2. 同一条再录一次 → 提示「这一段忙碌已经录过了」，轴上和列表条数都不变
3. 删掉这条 → 灰块消失，长橙块连回一整段
4. 日期改成 2026-11-16 → 轴上一整条橙（840 分钟），忙碌列表显示「这一天还没有记录」

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

### 时间轴是怎么画的

坐标只有三条规矩，`main.js` 顶部就能看到：

| 常量 | 值 | 为什么 |
| --- | --- | --- |
| `DAY_START` | 8×60 | 轴只画 08:00–22:00，范围外的时间本来就不参与计算 |
| `DAY_END` | 22×60 | 同上 |
| `PX_PER_MIN` | 44/60 | 每小时 44px，14 小时正好 616px，和 `index.html` 里 `.timeline` 的高度对应 |

块的 `top` 是 `(起始分钟 − DAY_START) × PX_PER_MIN`，高度是 `时长 × PX_PER_MIN`。要改密度只动 `PX_PER_MIN` 和 CSS 里那两处 616/44，别的地方都不用碰。

有两处「看起来像在算业务，其实只是整理画面」，记一下免得以后误会：

- **重叠的忙碌块会合成一块**（`mergeBusyForDisplay`）。同一时间三个人忙，轴上画三块互相盖住只会糊成一片，所以并成一块写「3 人忙碌」，具体是谁、干什么放在悬停的 `title` 里。**但这不是重算空闲** —— 哪段可用、哪段不可用，唯一的事实来源始终是 `/api/free-slots`。前端可以为展示做整理，不能自己判断业务事实，否则两边算法一旦不一致，页面也会「看起来对」，最难查。
- **越界的块会裁到轴内**。有人录了 06:00–09:00，轴上只画 08:00–09:00 那半截；整段在范围外的（比如 23:00–24:00）干脆不画。裁的是画，不是数据 —— 接口返回的还是原始起止。
- 块高不足 26px 时不塞文字，只留颜色；这是为什么有些块没标签，不是渲染漏了。

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

### 改界面时改了什么

从「一列文字」换成竖向时间轴，改到的只有两个文件：

| 文件 | 改动 |
| --- | --- |
| `frontend/index.html` | 样式整套重写（橙白黑）；加 `.timeline` 容器和图例；登录页/主界面/启动提示三块互斥显示 |
| `frontend/src/main.js` | 新增 `renderTimeline` / `mergeBusyForDisplay` / `appendBlock`；`loadSlots`、`loadEvents` 改成只把数据存进 `state`，由 `refresh()` 收尾时一次画完 |
| `backend/` 全部 | **零改动** |
| `shared/types.ts` | **零改动** |

后端一个字没动，原因很简单：画轴要的东西接口早就返回了 —— 空闲段带 `start` / `end` / `durationMinutes`，忙碌段带 `startTime` / `endTime` / `user`。**契约定对了，界面怎么换都不牵动后端**，这也是当初把 `durationMinutes` 一起回显的价值，前端不用自己减。

`loadSlots` / `loadEvents` 之所以不再各画各的，是因为轴要同时用两份数据：空闲段和忙碌段谁先回来都画不出正确的图，只能等 `Promise.all` 到齐。这是「渲染要等依赖齐」的最小例子，真实项目里数据一多，这层通常会长成一个专门的渲染函数。

### 加测试时改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/test/freeSlots.test.js` | 新增，六条用例 |
| `backend/package.json` | 加一行 `"test": "node --test"` |
| `src/` 下所有代码 | **零改动** |
| `frontend/` | **零改动** |

测试能一个文件搞定，是因为 `freeSlots.js` 从第一版起就是纯函数：收数组、回数组，不碰数据库、不读 `.env`、不认识 express。**能这样测的东西，通常也是最好复用、最容易搬走的东西** —— 这不是巧合，是当初分层的回报。反过来说，如果算法当初写在路由里（先查库、再算、再拼响应），要测它就得先起数据库，大多数团队到那一步就放弃了。

这也回答了「测试要写多少」：这个项目别的地方都有外部依赖，唯独算法层一个文件就能验完，所以测试只写这一个文件，把力气花在刀刃上。`index.js` 那堆校验、`auth.js` 那套会话，真要测就得上 HTTP 和数据库，性价比完全不同 —— 那是集成测试的活，不是现在这个阶段该干的。

## 部署到服务器

前面几节讲的都是**开发**形态：vite 边改边刷新，两个终端各跑一半。服务器上是另一套东西。

| | 本机开发 | 服务器 |
| --- | --- | --- |
| 前端 | `vite` 开发服务器（5173） | `npm run build` 出 `dist/`，nginx 直接发 |
| `/api` 转发 | `vite.config.mjs` 里的 `proxy` | `/etc/nginx/sites-enabled/scheduler` 里的 `proxy_pass` |
| 后端进程 | 窗口 A 里 `npm run dev`，关了就停 | systemd 管，崩了自动拉起、开机自启 |

**为什么必须换**：`vite` 是开发工具，它那个 `proxy` 只在开发时生效。`npm run build` 出来的 `dist/` 里只有两个文件（`index.html` 和一个带内容哈希的 js），没有任何东西会转发 `/api`。这件事必须由部署环境补上，否则浏览器请求 `/api/free-slots` 会打到静态目录上，404。

为什么不让浏览器直接请求 `3001` 端口：那就是跨域。跨域带 cookie 要求 `SameSite=None; Secure`，而 `Secure` 又要求 https，绕成死结。**同源是让 cookie 免费工作的前提。**

### 前置

Ubuntu 22.04 / 24.04，**1 核 1G 够用**（本文按 1G 写，2G 更省心）。需要 SSH 登录、有公网 IP、云平台防火墙放行 80。

### 1. 装运行环境

```bash
apt update
apt install -y postgresql postgresql-contrib nginx git curl

# Node 22：Ubuntu 自带的是 18，太老，跟本机对不上
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/node.sh
bash /tmp/node.sh
apt install -y nodejs
```

### 2. 1G 内存必须做的两件事

**加 swap。** 不加的话 `npm install` 和 PostgreSQL 会被系统直接杀掉，报错只有一句 `Killed`：

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

最后一行别漏 —— 漏了现在能用，一重启 swap 就没了，而且没有任何报错。

**调 PostgreSQL 参数。** 默认配置是按 4G 内存的机器设计的：

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET shared_buffers = '64MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET max_connections = '20';"
sudo -u postgres psql -c "ALTER SYSTEM SET maintenance_work_mem = '48MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET effective_cache_size = '256MB';"
systemctl restart postgresql
```

### 3. 建库、拉代码、导入表结构

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '你的密码';"
sudo -u postgres psql -c "CREATE DATABASE scheduler;"

cd /opt
git clone https://github.com/jia-qi-ma/multi-person-schedule.git
cd multi-person-schedule/backend
sudo -u postgres psql -d scheduler -f db/schema.sql
```

密码**只用字母和数字**：它后面要拼进连接串，出现 `@ : / # %` 会让连接串解析错位。

Linux 上不需要 `PGCLIENTENCODING` —— 那个坑是中文 Windows 版 psql 按 GBK 解码 `.sql` 造成的，Ubuntu 本来就是 UTF-8。

### 4. 配 .env

```bash
cp .env.example .env
nano .env
```

把 `DATABASE_URL` 里的占位密码换成真的，并**打开最后一行的 `HOST`**：

```
DATABASE_URL=postgresql://postgres:你的密码@localhost:5432/scheduler
HOST=127.0.0.1
```

`HOST=127.0.0.1` 让后端只监听本机，外面的请求必须经过 nginx。**本机开发不要加这一行**，否则手机连同一个 WiFi 就打不开页面了。

### 5. 装依赖、构建前端

```bash
cd /opt/multi-person-schedule/backend && npm install
cd ../frontend && npm install && npm run build
```

国内服务器先换 npm 源，不然装依赖很慢（写进 `~/.npmrc`，全局生效）：

```bash
npm config set registry https://registry.npmmirror.com
```

`dist/` 不进仓库（`.gitignore` 里有），必须在服务器上现构建。构建产物里的文件名带内容哈希，和源码版本一一对应；从别的机器传上去反而会漂。

### 6. 后端常驻

仓库里的 `deploy/scheduler.service` 就是这份配置，服务器上软链过去：

```bash
ln -s /opt/multi-person-schedule/deploy/scheduler.service /etc/systemd/system/scheduler.service
systemctl daemon-reload
systemctl enable --now scheduler
systemctl status scheduler --no-pager
```

看到 `active (running)` 和 `loaded (...; enabled; ...)` 两个词就成了。四个关键项，改动时别动错：

| 项 | 为什么必须这样 |
| --- | --- |
| `WorkingDirectory` | dotenv 从**当前工作目录**读 `.env`，不是从代码文件旁边。写错能起来但连不上库 |
| `EnvironmentFile` | 少了它 `DATABASE_URL` 进不了进程，启动立刻失败 |
| `Restart=always` | 崩了 3 秒后自动拉起，这才是「常驻」 |
| `After=postgresql.service` | 等数据库先起来，否则开机时连不上会循环重启 |

### 7. nginx

仓库里的 `deploy/nginx.conf`：

```bash
ln -s /opt/multi-person-schedule/deploy/nginx.conf /etc/nginx/sites-enabled/scheduler
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

- `rm ... default` 不能省：Ubuntu 自带的默认站点占着 80 端口当 `default_server`，不删它，新配的这个永远轮不上
- `nginx -t` 也不能省：配置有错时 `reload` 会让 nginx 直接挂掉、网站全断，先 `-t` 能在出事前拦住

`proxy_pass` 末尾**不能加斜杠**，原因写在配置文件注释里。

### 8. 放行 80 端口

云平台控制台的防火墙（或安全组）里加一条：TCP 80，来源 `0.0.0.0/0`。这一步在网页控制台做，不在服务器里 —— 服务器内 nginx 开着 80，云平台这一层不放行，外面照样打不开。

### 验证

```bash
curl -I http://127.0.0.1/                                  # 200 + text/html
curl -s 'http://127.0.0.1/api/free-slots?date=2026-11-15'  # JSON，两段空闲
```

先验本机内部这两条，再看外网：这样万一浏览器打不开，能立刻断定问题在防火墙、不在配置，不用两头猜。

浏览器打开 `http://<公网IP>`。**日期默认是今天，而基线数据在 2026-11-15** —— 第一眼看到一整天空闲是正常的，把日期改过去才有那两段。

### 更新代码上线

推完代码，服务器上固定三步：

```bash
cd /opt/multi-person-schedule && git pull
cd frontend && npm run build
systemctl restart scheduler
```

- 只有改了 `package.json` 的依赖，才需要多跑一次 `npm install`（前后端各自）
- `frontend` 变了必须重新 build，否则 nginx 发的还是旧的 `dist/`
- `backend` 变了必须 restart，否则 systemd 跑的还是内存里的老进程

这两件事都不做，`git pull` 成功也不会有任何变化。**部署后「改了没生效」，九成是漏了这两条中的一条。**

### 这套部署的已知代价

诚实记下来，都是主动接受的：

- **会话在后端内存里**：`systemctl restart scheduler` 之后所有人掉线。要多实例部署或免重启，得把会话挪到共享存储（Redis / 数据库表）
- **没有 https**：靠 IP 走 http，所以 cookie **不能加 `Secure`**。加了浏览器会直接丢弃，症状是「登录提示成功、页面一闪又回登录框」。哪天绑了域名再补
- **进程用 root 跑**：练习机可以接受。真实环境要建专用用户，`chown` 之后用 `User=` 指定
- **数据库密码明文躺在 `.env`**：靠文件权限挡，真实环境要走密钥管理
- **单机、无备份**：机器挂了数据就没了。这个项目的定位是作品集，不是生产系统

## 目录

- `shared/` — 接口契约 + Mock 数据，前后端共用同一份，别复制
- `frontend/` — 页面（vite）。接口调用和画时间轴都在 `src/main.js`，没有别的请求散落在别处
- `backend/` — 接口（express）
  - `src/index.js` — 路由、校验、错误码（管网络）
  - `src/auth.js` — 密码哈希、会话表、cookie（管身份）
  - `src/data.js` — 存取，写 SQL（管数据）
  - `src/freeSlots.js` — 算共同空闲（管算法，纯函数）
  - `src/db.js` — 数据库连接池（管连接）
  - `db/schema.sql` — 表结构、约束、基线数据
  - `test/freeSlots.test.js` — 算法测试，`npm test` 跑的就是它
- `deploy/` — 服务器上的两份配置（nginx 站点、systemd 服务定义）。服务器上软链过来，改配置就有 diff 可查

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
会话存在后端内存里，窗口 A 重启过就全失效了，重新登录即可。这不是 bug。部署到服务器后同理，`systemctl restart scheduler` 一次，所有人都要重新登录。

**部署后浏览器打不开（一直转圈 / 超时）**
云平台的防火墙没放行 80。这个开关在网页控制台，不在服务器里。先在服务器上跑 `curl -I http://127.0.0.1/`：返回 `200` 就说明 nginx 没问题，纯粹是外面进不来。

**部署后能打开页面，但接口全部 404**
nginx 的 `proxy_pass` 末尾多了斜杠。加了斜杠，nginx 会把 `/api/` 这段前缀替换掉，`/api/free-slots` 到后端就变成 `/free-slots`。

**改了代码推上去，服务器上没变化**
漏了 `npm run build`（前端）或 `systemctl restart scheduler`（后端）。`git pull` 只改磁盘上的文件，不会重跑构建、也不会重启进程。

**`psql` 里中文显示成乱码**
终端编码问题，不是数据坏了：`chcp 65001` 之后再查。

## 规则速览

- 共同空闲 = 可安排范围 − 全员忙碌时段的并集
- 默认范围 08:00–22:00，最短可用 30 分钟，忙碌块前后各留 15 分钟缓冲
- 录忙碌时「同一人 + 同一天 + 起止完全相同」判为重复，事由不参与比较
- 身份由后端会话决定，请求体里的 `userId` 一律拒绝（`UNKNOWN_FIELD`）
- 没有角色：系统里不存在「删别人」这个动作，只能注销自己；也没有管理员
- 详细规则、授权表、已知未做项见 `shared/types.ts`
