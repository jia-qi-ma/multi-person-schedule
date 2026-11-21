/**
 * 认证层：密码怎么存、会话怎么记。只此一处。
 *
 * 为什么单独一个文件，而不是塞进 index.js：
 *   「你是谁」的判断和「这个接口干什么」是两件事。
 *   以后要换成 JWT、要加短信验证码、要接公司统一登录，
 *   改的都是这里；index.js 里的路由一个字不用动。
 *
 * 密码为什么不能存原文：
 *   数据库一旦泄露（备份被拷走、云盘同步、DBA 误操作），
 *   原文密码等于全部账号失守，而且用户往往在别处也用同一个密码。
 *   scrypt 是单向的：只能验证，不能还原。盐（salt）保证
 *   两个人用同一个密码，存下来的哈希也不一样，无法用彩虹表批量猜。
 *   这里用 Node 自带的 crypto，不引入新依赖。
 */

const crypto = require('crypto')
const { promisify } = require('util')

const scrypt = promisify(crypto.scrypt)

const KEY_BYTES = 64
const SALT_BYTES = 16

/** 会话有效期 8 小时。没有过期时间的会话等于永久通行证，是常见的安全坑 */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

/** cookie 名。契约里写死了叫 sid，前端不需要知道，浏览器会自动带 */
const COOKIE_NAME = 'sid'

// ---------- 密码 ----------

/**
 * 把明文密码变成 `scrypt$盐$哈希` 三段的字符串。
 * 存成带前缀的格式，是为了以后能换算法：老用户继续用 scrypt 验，
 * 新用户用新算法，而不必让所有人重设密码。
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex')
  const key = await scrypt(password, salt, KEY_BYTES)
  return `scrypt$${salt}$${key.toString('hex')}`
}

/**
 * 校验密码。stored 是库里那串哈希。
 *
 * 用 timingSafeEqual 而不是 ===：普通比较一发现不同就返回，
 * 攻击者能靠响应时间的细微差异逐字节猜出哈希内容。
 * 格式不对时直接 return false，不要抛错 —— 数据库里可能有历史脏数据。
 */
async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false

  const [algo, salt, hashHex] = stored.split('$')
  if (algo !== 'scrypt' || !salt || !hashHex) return false

  const key = await scrypt(password, salt, KEY_BYTES)
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== key.length) return false

  return crypto.timingSafeEqual(key, expected)
}

// ---------- 会话 ----------

/**
 * sid → { userId, expiresAt }
 *
 * 为什么是 Map 而不是对象：Map 的键不参与原型链，不会出现
 * `__proto__` 这种奇怪的键把表搞乱；删除和查找也更直接。
 *
 * 这张表在进程内存里，所以后端一重启所有人掉线。契约里写了这个代价，
 * 也写了以后要多实例部署时该换成什么（共享存储 / 数据库表）。
 */
const sessions = new Map()

/** 登录成功后调用，返回要写进 cookie 的 sid */
function createSession(userId) {
  // 32 字节随机数：猜中的概率可以忽略，不需要额外的自增 id 或时间戳
  const sid = crypto.randomBytes(32).toString('hex')
  sessions.set(sid, { userId, expiresAt: Date.now() + SESSION_TTL_MS })
  return sid
}

/** 拿 sid 换 userId。过期或不存在都返回 null，过期顺手清掉 */
function readSession(sid) {
  if (!sid) return null

  const session = sessions.get(sid)
  if (!session) return null

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sid)
    return null
  }
  return session.userId
}

/** 登出：把表里那条划掉，手牌立刻失效 */
function destroySession(sid) {
  if (sid) sessions.delete(sid)
}

// ---------- cookie ----------

/**
 * 从请求头里读 sid。
 *
 * 没装 cookie-parser，因为这活儿就这几行：请求头长这样
 *   Cookie: a=1; sid=abc123; b=2
 * 按分号切开、找名字对上的那一段即可。
 * 不引入一个依赖只为做这件事，边界更清楚。
 */
function readSid(req) {
  const raw = req.headers.cookie
  if (!raw) return null

  for (const part of raw.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === COOKIE_NAME) {
      return part.slice(index + 1).trim() || null
    }
  }
  return null
}

/**
 * 登录成功时写的 cookie。
 *
 * HttpOnly  ：页面 JS 读不到，XSS 偷不走会话
 * SameSite=Lax：跨站发起的 POST 不带它，挡掉大部分 CSRF
 * Path=/    ：整个站点都带，不限于某个子路径
 * 没有 Secure：本地是 http，加了浏览器直接不收。上线必须加。
 */
function sessionCookie(sid) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  return `${COOKIE_NAME}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

/** 登出时写一个立即过期的同名 cookie，把浏览器那份擦掉 */
function clearedCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  readSession,
  destroySession,
  readSid,
  sessionCookie,
  clearedCookie,
}
