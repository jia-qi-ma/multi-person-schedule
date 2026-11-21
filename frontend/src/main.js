// 数据来源只写这一处：骨架阶段读 Mock，后端接好后改这一行即可
const DATA_SOURCE = '/free-slots.success.json'

const meta = document.querySelector('#meta')
const list = document.querySelector('#slots')

const res = await fetch(DATA_SOURCE)
const body = await res.json()

if (!body.success) {
  list.textContent = body.error
} else {
  const { date, userCount, minMinutes, bufferMinutes, slots } = body.data
  meta.textContent = `${date} · ${userCount} 人 · 最短 ${minMinutes} 分钟 · 缓冲 ${bufferMinutes} 分钟`
  slots.forEach((slot) => {
    const item = document.createElement('li')
    item.textContent = `${slot.start.slice(11)} – ${slot.end.slice(11)}（${slot.durationMinutes} 分钟）`
    list.appendChild(item)
  })
}
