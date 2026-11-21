/**
 * HTTP 层：接请求、校验参数、调算法、按契约 v1.1 回包。
 *
 * 这一层只管「网络进出」：
 *   - 查询串里的数字都是字符串，Number() 转换和校验归它
 *   - 默认值归它（默认值归后端，这是第 1 格拍的）
 *   - 响应里回显实际采用的值，也归它
 * 算的部分全在 freeSlots.js，取数据的部分全在 data.js。
 */

const express = require('express')
const { listUsers, listEventsByDate, addUser, findUser, addEvent, removeEvent, removeUser } =
  require('./data')
const { computeFreeSlots } = require('./freeSlots')

const app = express()
app.use(express.json())

// 默认值归后端：前端不传就用这几个，响应里会把实际采用的值回显出去
const DEFAULT_DAY_START = '08:00'
const DEFAULT_DAY_END = '22:00'
const DEFAULT_MIN_MINUTES = 30
const DEFAULT_BUFFER_MINUTES = 15

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** 所有失败都走这里，保证 body 形状统一：{ success:false, error, code } */
function fail(res, status, code, error) {
  return res.status(status).json({ success: false, error, code })
}

/** 查询串里的数字是字符串，转换和校验都在后端做 */
function parseNumber(raw, fallback) {
  if (raw === undefined) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : NaN
}

app.get('/api/free-slots', (req, res) => {
  const { date } = req.query

  // 参数格式校验。这一格没有引用别的资源，所以只查格式
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return fail(res, 400, 'INVALID_DATE', 'date 必须是 YYYY-MM-DD 格式')
  }

  const dayStart = req.query.dayStart === undefined ? DEFAULT_DAY_START : String(req.query.dayStart)
  const dayEnd = req.query.dayEnd === undefined ? DEFAULT_DAY_END : String(req.query.dayEnd)

  if (!TIME_RE.test(dayStart) || !TIME_RE.test(dayEnd)) {
    return fail(res, 400, 'INVALID_TIME', 'dayStart / dayEnd 必须是 HH:mm 格式')
  }
  if (dayStart >= dayEnd) {
    return fail(res, 400, 'INVALID_PARAMETER', 'dayStart 必须早于 dayEnd')
  }

  const minMinutes = parseNumber(req.query.minMinutes, DEFAULT_MIN_MINUTES)
  if (!Number.isInteger(minMinutes) || minMinutes < 0) {
    return fail(res, 400, 'INVALID_PARAMETER', 'minMinutes 必须是不小于 0 的整数')
  }

  const bufferMinutes = parseNumber(req.query.bufferMinutes, DEFAULT_BUFFER_MINUTES)
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0) {
    return fail(res, 400, 'INVALID_PARAMETER', 'bufferMinutes 必须是不小于 0 的整数')
  }

  // 取数据（存储层）→ 算（算法层）
  const users = listUsers()
  const events = listEventsByDate(date)
  const slots = computeFreeSlots({ events, dayStart, dayEnd, minMinutes, bufferMinutes })

  // 按契约回包：slots 的 start / end 是完整本地时间戳，不带时区
  res.json({
    success: true,
    data: {
      date,
      dayStart,
      dayEnd,
      minMinutes,
      bufferMinutes,
      userCount: users.length,
      slots: slots.map((s) => ({
        start: `${date}T${s.start}`,
        end: `${date}T${s.end}`,
        durationMinutes: s.durationMinutes,
      })),
    },
  })
})

// ---------- 成员 ----------

// GET /api/users：录入前的下拉框要用它拿成员列表
app.get('/api/users', (req, res) => {
  res.json({ success: true, data: listUsers() })
})

// POST /api/users：body 是 CreateUserInput（JSON）
// 契约里的两个错误：400 NAME_EMPTY / 409 NAME_DUPLICATE
app.post('/api/users', (req, res) => {
  const body = req.body || {}

  // ① 格式校验归 HTTP 层：body 里有没有一个像样的 name
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return fail(res, 400, 'NAME_EMPTY', 'name 不能为空')
  }

  // ② color 可选：给了就用（必须是非空字符串），没给由存储层分配默认调色板
  const color =
    typeof body.color === 'string' && body.color.trim() ? body.color.trim() : undefined

  // ③ 唯一性校验归存储层：只有它知道库里已经有哪些成员
  const user = addUser({ name, color })
  if (!user) {
    return fail(res, 409, 'NAME_DUPLICATE', `成员「${name}」已存在`)
  }

  // 201 = 新建成功。body 仍是统一信封，前端只判 success 就够
  res.status(201).json({ success: true, data: user })
})

// DELETE /api/users/:id：删成员，连带删掉他名下的忙碌（口径见契约「删除成员」）
// 响应只回 { id }，不回被连带删掉的那几条 —— 前端写完就重读，不需要明细
app.delete('/api/users/:id', (req, res) => {
  const removed = removeUser(req.params.id)
  if (!removed) {
    return fail(res, 404, 'NOT_FOUND', `成员「${req.params.id}」不存在`)
  }
  res.json({ success: true, data: { id: removed.id } })
})

// ---------- 忙碌时段 ----------

// GET /api/events?date=：列出某人某天的忙碌，页面列出来才能删
// 返回 EventWithUser（带 user），前端不用为了显示名字再发一次请求
app.get('/api/events', (req, res) => {
  const { date } = req.query

  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return fail(res, 400, 'INVALID_DATE', 'date 必须是 YYYY-MM-DD 格式')
  }

  const list = listEventsByDate(date).map((e) => ({
    ...e,
    user: findUser(e.userId),
  }))

  res.json({ success: true, data: list })
})

// POST /api/events：body 是 CreateEventInput（JSON）
// 错误按契约的优先级来：① 人存不存在 → ② 参数格式
app.post('/api/events', (req, res) => {
  const body = req.body || {}

  // ① 存在性优先。契约第 236 行：同样的输入永远回同一个 code
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!findUser(userId)) {
    return fail(res, 404, 'USER_NOT_FOUND', `userId「${userId}」对应的成员不存在`)
  }

  // ② 再校验格式
  const date = typeof body.date === 'string' ? body.date : ''
  if (!DATE_RE.test(date)) {
    return fail(res, 400, 'INVALID_DATE', 'date 必须是 YYYY-MM-DD 格式')
  }

  const startTime = typeof body.startTime === 'string' ? body.startTime : ''
  const endTime = typeof body.endTime === 'string' ? body.endTime : ''
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return fail(res, 400, 'INVALID_TIME', 'startTime / endTime 必须是 HH:mm 格式')
  }
  if (startTime >= endTime) {
    return fail(res, 400, 'INVALID_TIME', 'startTime 必须早于 endTime')
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) {
    return fail(res, 400, 'INVALID_PARAMETER', 'title 不能为空')
  }

  const event = addEvent({ userId, date, startTime, endTime, title })
  if (!event) {
    return fail(res, 409, 'DUPLICATE_EVENT', '这一段忙碌已经录过了（同一天、起止完全相同）')
  }
  res.status(201).json({ success: true, data: event })
})

// DELETE /api/events/:id：删一条忙碌
app.delete('/api/events/:id', (req, res) => {
  const removed = removeEvent(req.params.id)
  if (!removed) {
    return fail(res, 404, 'NOT_FOUND', `忙碌记录「${req.params.id}」不存在`)
  }
  res.json({ success: true, data: { id: removed.id } })
})

// 兜底：路径写错时也回统一形状，不是一个 HTML 报错页
app.use((req, res) => {
  fail(res, 404, 'NOT_FOUND', '接口不存在')
})

/**
 * 错误兜底：express.json() 解析失败时会带着 err 跳到这儿。
 *
 * 不接这一层，express 会吐一整页 HTML —— 前端 res.json() 解析不了，
 * 会被当成「连不上后端」，实际只是 JSON 写坏了，排查方向全错。
 *
 * 必须放在所有路由之后，而且必须写满 4 个参数：
 * express 靠「参数个数是不是 4」来认错误中间件，少一个就变成普通中间件了。
 */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return fail(res, 400, 'INVALID_PARAMETER', '请求体不是合法的 JSON')
  }
  console.error(err) // 真的没料到的错，先把栈打出来，再按契约回统一形状
  fail(res, 500, 'INTERNAL_ERROR', '服务器内部错误')
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`backend 已启动：http://localhost:${PORT}`)
})
