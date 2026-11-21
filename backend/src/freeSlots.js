/**
 * 算法层：只做计算，不碰 HTTP、不碰文件、不碰数据库。
 *
 * 契约第四节那一整段文字，一一对应这个文件：
 *   ① 并集：只要一个人忙，这段就不算全员空闲 → 合并，不是取交集
 *   ② 对每个「合并后的」忙碌块，前后各扣 bufferMinutes
 *   ③ 最后才按 minMinutes 筛（顺序不可反）
 *
 * 它是纯函数：同样的输入永远得到同样的输出，
 * 所以下一节换数据库、以后换框架，这个文件都不用改。
 */

/** "09:00" → 540（从 00:00 起算的分钟数，数字才好算） */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 540 → "09:00"，回给前端时再变回人看得懂的字符串 */
function toHHmm(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0')
  const m = String(minutes % 60).padStart(2, '0')
  return `${h}:${m}`
}

/** ① 把所有人的忙碌时段合成若干互不重叠的块（09:00-11:00 + 10:00-12:00 → 09:00-12:00） */
function mergeBusy(events) {
  const sorted = events
    .map((e) => ({ start: toMinutes(e.startTime), end: toMinutes(e.endTime) }))
    .sort((a, b) => a.start - b.start)

  const merged = []
  for (const cur of sorted) {
    const last = merged[merged.length - 1]
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end) // 有重叠或首尾相接，并进去
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

function computeFreeSlots({ events, dayStart, dayEnd, minMinutes, bufferMinutes }) {
  const startMin = toMinutes(dayStart)
  const endMin = toMinutes(dayEnd)

  // ① 并集 ② 每个忙碌块前后各扣缓冲 → 得到「不可用区间」
  //    必须用并集后的块：逐条原始记录扣，会在本就全员忙的重叠处产生无效缓冲
  const blocked = mergeBusy(events)
    .map((b) => ({
      start: Math.max(startMin, b.start - bufferMinutes),
      end: Math.min(endMin, b.end + bufferMinutes),
    }))
    .filter((b) => b.start < b.end) // 完全落在可安排范围之外的忙碌块，扣完会是空区间

  // 在 [dayStart, dayEnd) 里取补集：剩下的每一段就是共同空闲
  const free = []
  let cursor = startMin
  for (const b of blocked) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start })
    cursor = Math.max(cursor, b.end)
    if (cursor >= endMin) break
  }
  if (cursor < endMin) free.push({ start: cursor, end: endMin })

  // ③ 拿修正后的段去比长度，短于阈值的整段丢弃
  //    durationMinutes 由这里算好一并返回，前端不要自己 end - start 再算一遍
  return free
    .map((s) => ({
      start: toHHmm(s.start),
      end: toHHmm(s.end),
      durationMinutes: s.end - s.start,
    }))
    .filter((s) => s.durationMinutes >= minMinutes)
}

module.exports = { computeFreeSlots }
