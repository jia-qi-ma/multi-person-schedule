// 日期只写这一处。以后接日期选择器时，把常量换成用户选中的那一天即可。
const DATE = '2026-11-15'

const SLOTS_URL = `/api/free-slots?date=${DATE}`
const USERS_URL = '/api/users'
const EVENTS_URL = `/api/events?date=${DATE}`

const els = {
  meta: document.querySelector('#meta'),
  slots: document.querySelector('#slots'),
  users: document.querySelector('#users'),
  form: document.querySelector('#user-form'),
  name: document.querySelector('#user-name'),
  submit: document.querySelector('#user-form button'),
  feedback: document.querySelector('#user-feedback'),
  events: document.querySelector('#events'),
  eventDate: document.querySelector('#event-date'),
  eventForm: document.querySelector('#event-form'),
  eventUser: document.querySelector('#event-user'),
  eventStart: document.querySelector('#event-start'),
  eventEnd: document.querySelector('#event-end'),
  eventTitle: document.querySelector('#event-title'),
  eventSubmit: document.querySelector('#event-form button'),
  eventFeedback: document.querySelector('#event-feedback'),
}

/**
 * 所有请求都从这里走。它只做两件事：
 *   1. 后端连不上时也回一个统一形状 —— 页面各处不用各写一遍 try/catch
 *   2. 把统一信封原样交回去 —— 成功读 data、失败读 error / code，由调用方决定
 */
async function api(url, options) {
  try {
    const res = await fetch(url, options)
    return await res.json()
  } catch {
    return { success: false, error: '连不上后端：看看窗口 A 是否还在跑', code: 'NETWORK' }
  }
}

/** 提示行统一走这里，两个表单各有一行，别各写一套 */
function setFeedback(el, text, isError) {
  el.textContent = text
  el.className = isError ? 'hint error' : 'hint ok'
}

async function loadUsers() {
  const body = await api(USERS_URL)
  els.users.innerHTML = ''
  if (!body.success) {
    els.users.textContent = body.error
    return
  }
  body.data.forEach((user) => {
    const item = document.createElement('li')
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = user.color // color 是纯展示字段，怎么用由前端说了算
    item.append(dot, user.name)
    els.users.appendChild(item)
  })
  fillUserOptions(body.data)
}

/**
 * 下拉框跟着成员列表走。
 * 注意要先记住当前选中值再重建 —— refresh() 每次都重拉成员，
 * 不记的话用户刚选好的人会被重置成第一个。
 */
function fillUserOptions(users) {
  const selected = els.eventUser.value
  els.eventUser.innerHTML = ''
  users.forEach((user) => {
    const option = document.createElement('option')
    option.value = user.id
    option.textContent = user.name
    els.eventUser.appendChild(option)
  })
  if (selected) els.eventUser.value = selected
}

async function loadSlots() {
  const body = await api(SLOTS_URL)
  els.slots.innerHTML = ''
  if (!body.success) {
    els.slots.textContent = body.error
    return
  }
  const { date, userCount, minMinutes, bufferMinutes, slots } = body.data
  els.meta.textContent = `${date} · ${userCount} 人 · 最短 ${minMinutes} 分钟 · 缓冲 ${bufferMinutes} 分钟`
  slots.forEach((slot) => {
    const item = document.createElement('li')
    item.textContent = `${slot.start.slice(11)} – ${slot.end.slice(11)}（${slot.durationMinutes} 分钟）`
    els.slots.appendChild(item)
  })
}

async function loadEvents() {
  const body = await api(EVENTS_URL)
  els.events.innerHTML = ''
  if (!body.success) {
    els.events.textContent = body.error
    return
  }
  if (body.data.length === 0) {
    els.events.textContent = '这一天还没有记录'
    return
  }
  body.data.forEach((ev) => {
    const item = document.createElement('li')

    // EventWithUser 带回来的 user 正好用来显示名字和颜色，不用再查一次
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = ev.user ? ev.user.color : '#999'

    const label = document.createElement('span')
    label.textContent = `${ev.startTime} – ${ev.endTime}　${ev.user ? ev.user.name : '（已删除的成员）'} · ${ev.title}`

    const del = document.createElement('button')
    del.className = 'del'
    del.textContent = '删除'
    del.addEventListener('click', () => removeEvent(ev.id))

    item.append(dot, label, del)
    els.events.appendChild(item)
  })
}

async function removeEvent(id) {
  // DELETE 没有 body，也就不需要 Content-Type
  const body = await api(`/api/events/${id}`, { method: 'DELETE' })
  if (!body.success) {
    setFeedback(els.eventFeedback, body.error, true)
    return
  }
  setFeedback(els.eventFeedback, '已删除', false)
  await refresh()
}

/** 写完就重读：不把新数据拼进旧数组，一切以后端返回的为准 */
function refresh() {
  return Promise.all([loadUsers(), loadSlots(), loadEvents()])
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault() // 表单默认会让浏览器整页刷新，必须拦掉

  const name = els.name.value.trim()
  if (!name) {
    setFeedback(els.feedback, '名字不能为空', true) // 前端先挡一次，省一趟往返；后端那道校验照样保留
    return
  }

  els.submit.disabled = true
  try {
    const body = await api(USERS_URL, {
      method: 'POST',
      // 少了这一行，express.json() 不认识这串 body，后端会当没收到
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }), // 线上永远是字符串，不是对象
    })

    if (!body.success) {
      setFeedback(els.feedback, body.error, true) // 后端给的是人话，直接显示；输入框保留，方便改名重试
      return
    }

    els.form.reset()
    setFeedback(els.feedback, `已添加 ${body.data.name}`, false)
    await refresh()
  } finally {
    els.submit.disabled = false // 成功失败都要恢复，否则按钮会一直灰着
  }
})

els.eventForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const userId = els.eventUser.value
  const startTime = els.eventStart.value
  const endTime = els.eventEnd.value
  const title = els.eventTitle.value.trim()

  // 这几条都是「不值一趟往返」的明显错误；后端照样会再校验一遍
  if (!userId) return setFeedback(els.eventFeedback, '还没有成员，先在上面添加一个', true)
  if (!startTime || !endTime) return setFeedback(els.eventFeedback, '开始和结束时间都要填', true)
  if (startTime >= endTime) return setFeedback(els.eventFeedback, '开始时间必须早于结束时间', true)
  if (!title) return setFeedback(els.eventFeedback, '事由不能为空', true)

  els.eventSubmit.disabled = true
  try {
    const body = await api('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, date: DATE, startTime, endTime, title }),
    })

    if (!body.success) {
      // 409 DUPLICATE_EVENT、404 USER_NOT_FOUND 都从这儿出来，文案直接用后端的
      setFeedback(els.eventFeedback, body.error, true)
      return
    }

    els.eventTitle.value = '' // 只清事由，人和时间留着：连着录几条更顺手
    setFeedback(els.eventFeedback, '已录入', false)
    await refresh()
  } finally {
    els.eventSubmit.disabled = false
  }
})

els.eventDate.textContent = DATE

// 页面打开先拉一次
refresh()
