# 多人时间表

一个用来算「全员共同空闲时段」的练习项目。

## 跑起来

前置：Node.js（本机默认的 v22 即可）

需要**两个终端窗口**：一个跑后端，一个跑前端。两个都别关，要停服务按 Ctrl+C。

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

## 怎么算跑对了

页面上应出现：

- 一行说明：`2026-11-15 · 2 人 · 最短 30 分钟 · 缓冲 15 分钟`
- 两段空闲：`08:00 – 08:45（45 分钟）`、`12:15 – 22:00（585 分钟）`

想确认数据真的来自后端：**把窗口 A 停掉再刷新页面**，应该报错或空白。

## 现在的数据从哪来

后端算的，不是写死的。

页面请求 `/api/free-slots?date=2026-11-15` → vite 开发服务器转发到 `localhost:3001`
→ 后端从 `backend/src/data.js` 取忙碌记录 → `backend/src/freeSlots.js` 算并集、扣缓冲、筛时长
→ 按契约 v1.1 返回。

几处约定：

- 请求地址只写在 `frontend/src/main.js` 顶部的 `DATA_SOURCE` 一处。
- 字段形状以 `shared/types.ts` 为准，两边都照它写。
- `shared/mock/` 的两份假响应保留着：后端自测、页面测试都能拿它当样例，不是废文件。

## 目录

- `shared/` — 接口契约 + Mock 数据，前后端共用同一份，别复制
- `frontend/` — 页面（vite）
- `backend/` — 接口（express）。数据现在放在内存里，以后换数据库只改 `src/data.js`

## 规则速览

- 共同空闲 = 可安排范围 − 全员忙碌时段的并集
- 默认范围 08:00–22:00，最短可用 30 分钟，忙碌块前后各留 15 分钟缓冲
- 详细规则见 `需求表.md` 和 `shared/types.ts`
