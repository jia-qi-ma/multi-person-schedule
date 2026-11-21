/**
 * HTTP 层：接请求、校验参数、调算法、按契约 v2.0 回包。
 *
 * 这一层只管「网络进出」：
 *   - 查询串里的数字都是字符串，Number() 转换和校验归它
 *   - 默认值归它（默认值归后端，这是第 1 格拍的）
 *   - 响应里回显实际采用的值，也归它
 * 算的部分全在 freeSlots.js，取数据的部分全在 data.js，
 * 「你是谁」的判断全在 auth.js。
 *
 * v2.0 的边界：请求体里不再有任何身份字段。
 * 谁在发请求，只看会话（cookie 里的 sid），不看客户端说了什么。
 */

const express = require('express')
const {
  listUsers,
  listEventsByDate,
  addUser,
  findUser,
  findUserByName,
  findEventById,
  addEvent,
  removeEvent,
  removeUser,
} = require('./data')
const {
  hashPassword,
  verifyPassword,
  createSession,
  readSession,
  destroySession,
  readSid,
  sessionCookie,
  clearedCookie,
} = require('./auth')
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

/**
 * 姓名不存在时拿来凑数的一串哈希，格式和真的一样、内容永远对不上。
 *
 * 为什么要多跑一次没用的校验：如果查不到人就立刻返回，
 * 「这个人不存在」会比「密码错」快几十毫秒，攻击者靠计时就能
 * 试出哪些名字有账号。让两条路径花一样的时间，才叫真的不区分。
 */
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`

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

/**
 * 「必须登录」的中间件。挂在写接口前面，认证失败的请求根本进不到业务代码。
 *
 * 为什么写成中间件而不是每个路由里 if 一下：
 *   七个接口里只要有一个人忘了写，就是一个洞，而且不会有任何报错。
 *   挂一次，所有接口共用同一条判断，加新接口时很难漏。
 *
 * 顺手把用户对象挂在 req.user 上，后面的路由不用再查一次。
 */
async function requireAuth(req, res, next) {
  const sid = readSid(req)
  const userId = readSession(sid)

  if (!userId) {
    return fail(res, 401, 'UNAUTHENTICATED', '请先登录')
  }

  const user = await findUser(userId)
  if (!user) {
    // 会话还在，但人已经被删了。当成未登录处理，并清掉这条死会话
    destroySession(sid)
    res.setHeader('Set-Cookie', clearedCookie())
    return fail(res, 401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录')
  }

  req.user = user
  next()
}

// ---------- 登录 / 登出 ----------

// POST /api/login：body 是 LoginInput（JSON）。成功发 cookie，失败一律 LOGIN_FAILED
app.post('/api/login', async (req, res) => {
  const body = req.body || {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!name || !password) {
    return fail(res, 400, 'INVALID_PARAMETER', 'name 和 password 都不能为空')
  }

  const user = await findUserByName(name)
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH)

  // 不区分「没这个人」和「密码错」：回同一句话、同一个 code。
  // 否则这个接口就变成了「查谁有账号」的工具。
  if (!ok) {
    return fail(res, 401, 'LOGIN_FAILED', '姓名或密码不对')
  }

  res.setHeader('Set-Cookie', sessionCookie(createSession(user.id)))
  // 只回契约里的三个字段。passwordHash 到这儿为止，不进响应
  res.json({ success: true, data: { id: user.id, name: user.name, color: user.color } })
})

// POST /api/logout：不需要登录也能调（重复登出也算成功，省得前端还要判断）
app.post('/api/logout', (req, res) => {
  destroySession(readSid(req))
  res.setHeader('Set-Cookie', clearedCookie())
  res.json({ success: true, data: { loggedOut: true } })
})

// GET /api/me：页面刷新后靠它判断「我还登录着吗」，顺便拿到当前用户
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ success: true, data: req.user })
})

// ---------- 空闲时段（读，公开） ----------

app.get('/api/free-slots', async (req, res) => {
  const { date } = req.query

  // 参数格式校验。这个接口没有引用别的资源，所以只查格式
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
  const users = await listUsers()
  const events = await listEventsByDate(date)
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

// ---------- 注册 / 成员 ----------

// GET /api/users：读接口，公开。成员列表就靠它
app.get('/api/users', async (req, res) => {
  res.json({ success: true, data: await listUsers() })
})

/**
 * POST /api/register：注册 = 自己给自己开户。公开，不需要登录。
 *
 * 为什么把原来的 POST /api/users 换掉：
 *   那个接口是「登录之后替别人开户」，等于谁都能造账号；而删人只能删自己，
 *   造出来的账号谁也清不掉 —— 误加一个打错名字的成员，就永远留在列表里。
 *   换成注册制后，成员一定是本人建的：自己注册、自己录、自己注销。
 *   权责一致，也就不需要管理员来收拾残局。
 *
 * 顺序：① 400 NAME_EMPTY → ② 400 INVALID_PARAMETER（密码长度）→ ③ 409 NAME_DUPLICATE
 *
 * 这里不写 cookie，也就是说注册不自动登录。
 * 「注册完直接进主界面」是前端的组合（注册成功后再调一次登录），
 * 不是接口里藏着的第二种行为 —— 接口各自只做一件事，好测也好换。
 */
app.post('/api/register', async (req, res) => {
  const body = req.body || {}

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return fail(res, 400, 'NAME_EMPTY', 'name 不能为空')
  }

  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 6) {
    return fail(res, 400, 'INVALID_PARAMETER', 'password 至少 6 位')
  }

  // color 可选：给了就用（必须是非空字符串），没给由存储层分配默认调色板
  const color =
    typeof body.color === 'string' && body.color.trim() ? body.color.trim() : undefined

  // 密码到数据库里只剩哈希。这一行之后再没有任何地方能拿到原文
  const passwordHash = await hashPassword(password)

  const user = await addUser({ name, color, passwordHash })
  if (!user) {
    return fail(res, 409, 'NAME_DUPLICATE', `成员「${name}」已存在`)
  }

  res.status(201).json({ success: true, data: user })
})

// DELETE /api/users/:id：v2.0 起只有一个合法用途 —— 注销自己
//
// 顺序：① 404（这个人存不存在）→ ② 403（是不是你自己）。
// 和 DELETE /api/events 一样，404 必须排在 403 前面：
// 反过来的话，删一个不存在的 id 会回 403，等于承认「这个 id 存在」。
//
// 为什么要判这一下：登录只回答了「你是谁」，没回答「这件事你凭什么做」。
// 没有管理员，就推导不出「谁能删别人」，所以这个动作在本系统里直接不存在。
app.delete('/api/users/:id', requireAuth, async (req, res) => {
  const target = await findUser(req.params.id)
  if (!target) {
    return fail(res, 404, 'NOT_FOUND', `成员「${req.params.id}」不存在`)
  }

  if (target.id !== req.user.id) {
    return fail(res, 403, 'FORBIDDEN', '只能注销自己的账号')
  }

  const removed = await removeUser(target.id)

  // 注销自己：会话立刻失效，顺手把 cookie 也擦掉，别让浏览器留着一个死 sid
  destroySession(readSid(req))
  res.setHeader('Set-Cookie', clearedCookie())

  res.json({ success: true, data: { id: removed.id } })
})

// ---------- 忙碌时段 ----------

// GET /api/events?date=：读，公开。返回 EventWithUser（带 user）
app.get('/api/events', async (req, res) => {
  const { date } = req.query

  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return fail(res, 400, 'INVALID_DATE', 'date 必须是 YYYY-MM-DD 格式')
  }

  const list = await listEventsByDate(date)
  res.json({ success: true, data: list })
})

// POST /api/events：body 是 CreateEventInput（JSON），**没有 userId**
app.post('/api/events', requireAuth, async (req, res) => {
  const body = req.body || {}

  // ① 身份不在 body 里了。还带着 userId 的，一定是没跟着升级的老客户端，
  //    必须当场报错，而不是顺手忽略 —— 忽略会让它以为存给了别人。
  if (Object.prototype.hasOwnProperty.call(body, 'userId')) {
    return fail(
      res,
      400,
      'UNKNOWN_FIELD',
      '请求体里的 userId 已废弃（契约 v2.0）：身份由登录会话决定，请删掉该字段',
    )
  }

  // ② 校验格式
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

  // ③ 归属从会话取。这一行就是整次变更的核心
  const event = await addEvent({ userId: req.user.id, date, startTime, endTime, title })
  if (!event) {
    return fail(res, 409, 'DUPLICATE_EVENT', '这一段忙碌已经录过了（同一天、起止完全相同）')
  }
  res.status(201).json({ success: true, data: event })
})

// DELETE /api/events/:id：只能删自己的
// 顺序：404（不存在）→ 403（不归你）。反过来会泄露「这条记录存在」
app.delete('/api/events/:id', requireAuth, async (req, res) => {
  const found = await findEventById(req.params.id)
  if (!found) {
    return fail(res, 404, 'NOT_FOUND', `忙碌记录「${req.params.id}」不存在`)
  }

  if (found.userId !== req.user.id) {
    return fail(res, 403, 'FORBIDDEN', '只能删除自己的忙碌记录')
  }

  const removed = await removeEvent(req.params.id)
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

// 端口可以用环境变量覆盖：自测时开一个临时实例（PORT=3999）就不会跟正在跑的那个抢
const PORT = Number(process.env.PORT) || 3001
app.listen(PORT, () => {
  console.log(`backend 已启动：http://localhost:${PORT}`)
})
