\encoding UTF8

-- ============================================================
-- 多人时间表 · 数据库结构
-- ============================================================
--
-- 这份文件必须进版本库。
-- 光有代码没有它，换台机器、换个人就建不出库 ——
-- 「在我这儿能跑」只存在于你的硬盘上，这是团队里最常见的事故。
--
-- 用法（在项目根目录执行，会提示输入 postgres 密码）：
--   psql -U postgres -d scheduler -f backend/db/schema.sql
--
-- ⚠️ 这个脚本会先删表再建表，重跑等于清空数据。现在只有基线数据，无所谓；
--    等表里有真实数据时要改成 migration（增量改动），不能再这么干。
--
-- 关于 id：UUID 由数据库生成（gen_random_uuid，PostgreSQL 13+ 内置）。
-- 不用自增整数，是因为契约里 id 是 string —— 库里给什么、API 就出什么，
-- 中间不做类型转换，契约才能一个字不改。

DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL UNIQUE,
  color text NOT NULL
);

CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       date NOT NULL,
  start_time time NOT NULL,
  end_time   time NOT NULL,
  title      text    NOT NULL,

  -- ① 级联删除写成声明，不再靠应用层手写 filter。
  --    ON DELETE CASCADE 的意思是：删 users 里的一行，数据库自己清掉
  --    所有指向它的 events。应用层想漏也漏不掉，并发下也不会漏。
  --    （data.js 里那段 filter + 清空数组，会整段消失）

  -- ② 时间必须正着走。原来这条在 index.js 里用 JS 比字符串，
  --    现在数据库也拦一道：绕过 HTTP 直接写库时照样挡得住。
  CONSTRAINT events_time_order CHECK (start_time < end_time),

  -- ③ 查重口径（同一人 + 同一天 + 起止完全相同）也下推到数据库。
  --    应用层再检查一遍是「提前告知」，这里是「最后一道防线」：
  --    两个请求同时插入时，只有数据库这层挡得住。
  --    冲突时 PostgreSQL 报 23505，由 data.js 翻译成「重复」。
  CONSTRAINT events_no_duplicate UNIQUE (user_id, date, start_time, end_time)
);

-- 「查某人某天的忙碌」是最高频的查询，单独建索引
CREATE INDEX events_by_date ON events (date);

-- ============================================================
-- 基线数据（和 data.js 里原来那两条一致，保证页面显示不变）
-- ============================================================
INSERT INTO users (id, name, color) VALUES
  ('00000000-0000-0000-0000-000000000001', '张三', '#4f8ef7'),
  ('00000000-0000-0000-0000-000000000002', '李四', '#f2994a');

INSERT INTO events (user_id, date, start_time, end_time, title) VALUES
  ('00000000-0000-0000-0000-000000000001', '2026-11-15', '09:00', '11:00', '组会'),
  ('00000000-0000-0000-0000-000000000002', '2026-11-15', '10:00', '12:00', '实验课');
