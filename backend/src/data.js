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

/** 这一格只有读，没有写。写接口（POST /api/events 等）留到后面 */
function listUsers() {
  return users
}

function listEventsByDate(date) {
  return events.filter((e) => e.date === date)
}

module.exports = { listUsers, listEventsByDate }
