/**
 * 存储层：PostgreSQL 版。
 *
 * 这一节就是来验证第 3 格那句「换存储只改这个文件」的。
 * 结果：freeSlots.js 一个字没动（它算的是纯数据，不知道数据从哪来），
 *      前端一个字没动（它只认契约）。
 *
 * 但有一个变化挡不住：所有函数都变成 async 了。
 * 内存是同步的（数组里取一下就返回），数据库是异步的（要等结果回来）。
 * 这会穿透到 index.js 的调用处（加 await），但路由、校验、错误码都不该动。
 */

const { query } = require('./db')

/** 新成员没指定颜色时，从这套调色板里轮着取一个（契约：color 可选，默认值归后端） */
const COLOR_PALETTE = ['#4f8ef7', '#f2994a', '#27ae60', '#9b51e0', '#eb5757', '#2d9cdb']

/** PostgreSQL 的唯一约束冲突错误码。数据库不懂 HTTP，翻译交给上层 */
const UNIQUE_VIOLATION = '23505'

// ---------- 读 ----------

async function listUsers() {
  const { rows } = await query('SELECT id, name, color FROM users ORDER BY name')
  return rows
}

/**
 * 按 id 找成员，找不到返回 null。
 *
 * 用 id::text 比较而不是 id = $1：
 * 前端传个非法值（比如 "abc"）时，直接比较会让 PostgreSQL 抛 22P02
 * （uuid 格式错误），回一个 500；而我们要的是「找不到这个人」。
 */
async function findUser(id) {
  const { rows } = await query('SELECT id, name, color FROM users WHERE id::text = $1', [id])
  return rows[0] || null
}

/**
 * 某人某天的忙碌，连成员信息一起带回来。
 *
 * 为什么用 JOIN 而不是先查 events、再对每条调 findUser：
 * 那是 N+1 查询 —— 10 条记录要发 11 次 SQL。内存版没这个问题
 * （数组里取一下就好），换成数据库后才浮出来。
 *
 * to_char 是为了对齐契约：数据库里 date 是 date 类型、time 是 time 类型，
 * 直接读出来会被 pg 转成 JS Date，JSON 化就成了 "2026-11-15T00:00:00.000Z"。
 * 契约要的是 "2026-11-15" 和 "09:00"，在 SQL 层裁干净最省事。
 */
async function listEventsByDate(date) {
  const { rows } = await query(
    `SELECT e.id,
            e.user_id                        AS "userId",
            to_char(e.date, 'YYYY-MM-DD')    AS date,
            to_char(e.start_time, 'HH24:MI') AS "startTime",
            to_char(e.end_time, 'HH24:MI')   AS "endTime",
            e.title,
            u.id    AS "user.id",
            u.name  AS "user.name",
            u.color AS "user.color"
       FROM events e
       JOIN users u ON u.id = e.user_id
      WHERE e.date = $1::date
      ORDER BY e.start_time`,
    [date],
  )

  // pg 返回的是一行扁平对象（key 是 "user.id" 这种），这里组装成契约要的嵌套形状
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    title: r.title,
    user: { id: r['user.id'], name: r['user.name'], color: r['user.color'] },
  }))
}

// ---------- 写 ----------

/**
 * 新增成员。
 *
 * 重名检查不再写在应用层 —— users.name 上有 UNIQUE 约束，
 * 插入冲突时 PostgreSQL 报 23505，这里翻译成 null。
 * 仍然返回 null 表示「没存成」：存储层不认识 HTTP 状态码，回什么错误由上层决定。
 */
async function addUser({ name, color }) {
  // 颜色：没指定就从调色板里轮着取一个。数量来自数据库，不再是数组长度
  let picked = color
  if (!picked) {
    const { rows } = await query('SELECT count(*)::int AS n FROM users')
    picked = COLOR_PALETTE[rows[0].n % COLOR_PALETTE.length]
  }

  try {
    const { rows } = await query(
      'INSERT INTO users (name, color) VALUES ($1, $2) RETURNING id, name, color',
      [name, picked],
    )
    return rows[0]
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) return null
    throw err // 别的错不是「重名」，往上报，让上层回 500
  }
}

/**
 * 新增一条忙碌。
 *
 * 查重（同一人 + 同一天 + 起止完全相同）也交给数据库的 UNIQUE 约束，
 * 冲突时同样是 23505。应用层那道校验的价值是提前给人话错误，
 * 数据库这道是最后防线：两个请求同时插入时，只有它是原子的。
 *
 * 这里只负责存和翻译，不判断时间格式 —— 格式只有 HTTP 层看得到。
 */
async function addEvent({ userId, date, startTime, endTime, title }) {
  try {
    const { rows } = await query(
      `INSERT INTO events (user_id, date, start_time, end_time, title)
       VALUES ($1, $2::date, $3::time, $4::time, $5)
       RETURNING id,
                 user_id                        AS "userId",
                 to_char(date, 'YYYY-MM-DD')    AS date,
                 to_char(start_time, 'HH24:MI') AS "startTime",
                 to_char(end_time, 'HH24:MI')   AS "endTime",
                 title`,
      [userId, date, startTime, endTime, title],
    )
    return rows[0]
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) return null
    throw err
  }
}

/** 删一条忙碌。删不到返回 null，回什么错误由上层决定（跟 addUser 一个套路） */
async function removeEvent(id) {
  const { rows } = await query('DELETE FROM events WHERE id::text = $1 RETURNING id', [id])
  return rows[0] || null
}

/**
 * 删一个成员。
 *
 * 注意这里只有一条 DELETE —— 原先「先清掉他名下忙碌」那几行全没了。
 * 因为 ON DELETE CASCADE 写在表定义里，数据库自己会级联。
 * 好处不只是代码短：应用层想漏都漏不掉，并发下也不会漏。
 */
async function removeUser(id) {
  const { rows } = await query('DELETE FROM users WHERE id::text = $1 RETURNING id', [id])
  return rows[0] || null
}

module.exports = { listUsers, listEventsByDate, addUser, findUser, addEvent, removeEvent, removeUser }
