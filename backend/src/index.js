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
const { listUsers, listEventsByDate } = require('./data')
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

// 兜底：路径写错时也回统一形状，不是一个 HTML 报错页
app.use((req, res) => {
  fail(res, 404, 'NOT_FOUND', '接口不存在')
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`backend 已启动：http://localhost:${PORT}`)
})
