/**
 * 存储层：这一格先用内存里两条假数据，够验证算法就行。
 *
 * 下一节换成 PostgreSQL 时，只改这个文件 —— freeSlots.js 和 index.js 一个字不动。
 * 这正是第 1 格说的「存储实现可替换」，也是检验分层有没有分对的方式：
 * 换存储的时候，需要改几个文件？
 */

const users = [
  { id: 'u_zhangsan', name: '张三', color: '#4f8ef7' },
  { id: 'u_lisi', name: '李四', color: '#f2994a' },
]

// 基线两组数据：张三 09:00-11:00、李四 10:00-12:00
// 算出来应该正好等于 shared/mock/free-slots.success.json 里那两段
const events = [
  {
    id: 'e1',
    userId: 'u_zhangsan',
    date: '2026-11-15',
    startTime: '09:00',
    endTime: '11:00',
    title: '组会',
  },
  {
    id: 'e2',
    userId: 'u_lisi',
    date: '2026-11-15',
    startTime: '10:00',
    endTime: '12:00',
    title: '实验课',
  },
]

/** 新成员没指定颜色时，从这套调色板里轮着取一个（契约：color 可选，默认值归后端） */
const COLOR_PALETTE = ['#4f8ef7', '#f2994a', '#27ae60', '#9b51e0', '#eb5757', '#2d9cdb']

// 内存里的自增 id。下一节换 PostgreSQL，这行会交给数据库的自增主键 / UUID
let userSeq = 0

function nextUserId() {
  userSeq += 1
  return `u_${userSeq}`
}

// 忙碌记录的自增 id。从现有条数起算，避免和种子里的 e1 / e2 撞号
let eventSeq = events.length

function nextEventId() {
  eventSeq += 1
  return `e${eventSeq}`
}

// ---------- 读 ----------

function listUsers() {
  return users
}

/**
 * 按 id 找成员，找不到返回 null。
 * 录忙碌时要先确认「这个人在不在」，这个判断只有存储层做得出来。
 */
function findUser(id) {
  return users.find((u) => u.id === id) || null
}

function listEventsByDate(date) {
  return events.filter((e) => e.date === date)
}

// ---------- 写 ----------

/**
 * 新增成员。
 *
 * 重名检查放在这里、不放在 index.js：只有存储层知道「库里已经有哪些人」。
 * 重名时不抛异常、只返回 null —— 这一层不认识 HTTP 状态码和 code，
 * 回什么错误由上层决定。存储只负责「存成了 / 没存成」。
 */
function addUser({ name, color }) {
  if (users.some((u) => u.name === name)) return null

  const user = {
    id: nextUserId(),
    name,
    color: color || COLOR_PALETTE[users.length % COLOR_PALETTE.length],
  }
  users.push(user)
  return user
}

/**
 * 新增一条忙碌记录。
 *
 * 这里只负责存和查重，不判断「时间格式对不对」——
 * 格式只有 HTTP 层看得到，存在性由上层问 findUser。
 *
 * 查重口径（产品规则，2026-11-21 拍板）：同一人 + 同一天 + 起止完全相同 → 重复。
 * title 不参与比较：那个时段已经被占住了，换个事由再录一次也是误操作。
 * 命中时返回 null，由上层决定回 409 DUPLICATE_EVENT —— 存储层不认识 HTTP 码。
 */
function addEvent({ userId, date, startTime, endTime, title }) {
  const duplicated = events.some(
    (e) =>
      e.userId === userId && e.date === date && e.startTime === startTime && e.endTime === endTime,
  )
  if (duplicated) return null

  const event = {
    id: nextEventId(),
    userId,
    date,
    startTime,
    endTime,
    title,
  }
  events.push(event)
  return event
}

/** 删一条忙碌记录。删不到返回 null，回什么错误由上层决定（跟 addUser 一个套路） */
function removeEvent(id) {
  const index = events.findIndex((e) => e.id === id)
  if (index === -1) return null
  return events.splice(index, 1)[0]
}

/**
 * 删一个成员，连带删掉他名下的所有忙碌记录（2026-11-21 拍板）。
 *
 * 为什么级联：忙碌记录靠 userId 依附于成员，人没了记录就无所归属。
 * 代价是「删人」比看上去重 —— 他占的时段一起消失，共同空闲会变多，
 * 所以前端删之前要二次确认，这句也写进了契约的「删除成员的口径」。
 *
 * 删不到返回 null，回什么错误由上层决定（跟 removeEvent 一个套路）。
 */
function removeUser(id) {
  const index = users.findIndex((u) => u.id === id)
  if (index === -1) return null
  const [removed] = users.splice(index, 1)

  // 用 filter 重建再原地写回：边遍历边 splice 会漏掉紧跟其后的那一条。
  // events 是 const，不能整个换成新数组，所以清空后 push 回去。
  const kept = events.filter((e) => e.userId !== id)
  events.length = 0
  events.push(...kept)

  return removed
}

module.exports = { listUsers, listEventsByDate, addUser, findUser, addEvent, removeEvent, removeUser }
