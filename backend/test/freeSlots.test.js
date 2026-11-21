/**
 * freeSlots.js 的测试。
 *
 * 为什么只有这一个文件：算法是整个项目里唯一「算错了页面也不会报错」的地方 ——
 * 它算出一段错的空闲，页面照样渲染得很漂亮。所以它最需要有人盯着。
 *
 * 用例的选择标准是「可能真出错的地方」，不是「把代码走一遍」：
 *   ① 并集（相接要不要合并）
 *   ② 缓冲从两边各扣（间隙不够就被吃光）
 *   ③ 扣缓冲在前、按最短时长筛在后（顺序反了会多出一段）
 *   ④ 越界的忙碌不能算出负数时间
 *
 * 用 node 自带的 test runner，不装任何依赖：node --test
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { computeFreeSlots } = require('../src/freeSlots')

/** 基线参数：08:00–22:00，最短 30 分钟，缓冲 15 分钟。每条用例只覆盖自己想改的那一项 */
const BASE = {
  dayStart: '08:00',
  dayEnd: '22:00',
  minMinutes: 30,
  bufferMinutes: 15,
}

/** 算法只用 startTime / endTime，其余字段（id、title、user）写了也是噪音 */
const ev = (startTime, endTime) => ({ startTime, endTime })

test('基线：两人忙碌重叠，算出两段空闲', () => {
  // 这组数就是 README「怎么算跑对了」里的那一组。
  // 写进测试的意思是：以后谁改算法，改到它不对，终端会立刻说话，而不是等人打开页面发现
  const slots = computeFreeSlots({
    ...BASE,
    events: [ev('09:00', '11:00'), ev('10:00', '12:00')],
  })

  assert.deepEqual(slots, [
    { start: '08:00', end: '08:45', durationMinutes: 45 },
    { start: '12:15', end: '22:00', durationMinutes: 585 },
  ])
})

test('没人忙碌：一整天都是空闲', () => {
  // 边界全靠这一个用例盯着：起点是 dayStart 而不是 00:00，终点是 dayEnd 而不是 24:00
  const slots = computeFreeSlots({ ...BASE, events: [] })

  assert.deepEqual(slots, [{ start: '08:00', end: '22:00', durationMinutes: 840 }])
})

test('首尾相接的两块忙碌合并成一块', () => {
  // 09:00–10:00 接着 10:00–11:00，中间没有缝，结果里也不该出现 0 分钟的空闲段。
  //
  // 诚实记一笔：这条挡不住把 mergeBusy 里的 `<=` 写成 `<`。
  // 缓冲 15 分钟从两边各扣，相接处会被扣成互相重叠（上一块到 10:15，下一块从 09:45 开始），
  // 两种写法算出来的最终结果完全一致。真要验那个细节，只能把 mergeBusy 单独导出来测中间结构，
  // 那是另一种设计取舍 —— 所以这是**已知的测试盲区**，不是漏写，写在这儿免得下一个人以为它在守。
  const slots = computeFreeSlots({
    ...BASE,
    events: [ev('09:00', '10:00'), ev('10:00', '11:00')],
  })

  assert.deepEqual(slots, [
    { start: '08:00', end: '08:45', durationMinutes: 45 },
    { start: '11:15', end: '22:00', durationMinutes: 645 },
  ])
})

test('忙碌超出可安排范围：裁到边界，不产生负数时间', () => {
  // 有人录了 06:00–09:00。06:00 在 08:00 之前，扣缓冲后不能变成 05:45 这种鬼东西，
  // 也不能让结果里冒出 06:00 开头的空闲段
  const slots = computeFreeSlots({ ...BASE, events: [ev('06:00', '09:00')] })

  assert.deepEqual(slots, [{ start: '09:15', end: '22:00', durationMinutes: 765 }])
})

test('缓冲从两边各扣：间隙 20 分钟被吃光（最短时长不参与）', () => {
  // 这条专门验缓冲。所以把 minMinutes 压到 0 —— 就算有一段 20 分钟的空闲，
  // 也不会是「最短时长」筛掉的，只能是缓冲吃掉的。
  //
  // 两个忙碌块之间隔着 10:00–10:20。前一块扣完缓冲到 10:15，后一块从 10:05 开始，
  // 两个不可用区间自己黏上了，缝就不存在了。
  const slots = computeFreeSlots({
    ...BASE,
    minMinutes: 0,
    events: [ev('09:00', '10:00'), ev('10:20', '11:20')],
  })

  assert.deepEqual(
    slots.map((s) => `${s.start}-${s.end}`),
    ['08:00-08:45', '11:35-22:00'],
    '20 分钟的间隙应该被两边的缓冲吃光，不是被最短时长筛掉',
  )
})

test('同样的间隙，缓冲为 0 时它会存在，然后被最短时长筛掉', () => {
  // 和上一条同一组忙碌，只把 bufferMinutes 去掉。这次 10:00–10:20 真的算出来了，
  // 但因为只有 20 分钟、短于 30 分钟，最后不出现在结果里 ——
  // 而它消失后，两边的空闲段也跟着变长了（09:00 结束、11:20 开始），
  // 这就是「先扣缓冲、再筛时长」的证据：筛的时候拿到的是已经扣完的段
  const slots = computeFreeSlots({
    ...BASE,
    bufferMinutes: 0,
    events: [ev('09:00', '10:00'), ev('10:20', '11:20')],
  })

  assert.deepEqual(slots, [
    { start: '08:00', end: '09:00', durationMinutes: 60 },
    { start: '11:20', end: '22:00', durationMinutes: 640 },
  ])
})
