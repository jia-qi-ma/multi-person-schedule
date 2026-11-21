/**
 * 前端入口（契约 v2.0）。
 *
 * 这一版和前几版最大的不同：页面不再一打开就拉数据，
 * 而是先问一句「我是谁」（GET /api/me），再由答案决定显示登录框还是整套界面。
 *
 * 另外有一条纪律贯穿全文：**前端不自己判断「我能不能做这件事」**。
 * 这里所有的显示/隐藏都只是为了让界面干净，真正的权限判断只有一个地方 —— 后端。
 */

/**
 * 当前登录的人。null 表示未登录。
 * id 用来判断「这条忙碌是不是我的」（只影响要不要画删除按钮），
 * name 用来显示「以谁的身份录入」。
 */
let currentUser = null

/**
 * 日期不在模块加载时算死，而是每次发请求前现读输入框。
 * 如果写成 const DATE = ...，页面一打开就定格了 —— 用户之后改日期，
 * 请求还落在旧的那天，最难查的是它不报错。
 */
function currentDate() {
  return els.datePicker.value
}

const slotsUrl = () => `/api/free-slots?date=${currentDate()}`
const eventsUrl = () => `/api/events?date=${currentDate()}`
const USERS_URL = '/api/users'

const els = {
  boot: document.querySelector('#boot'),
  loginView: document.querySelector('#login-view'),
  loginForm: document.querySelector('#login-form'),
  loginName: document.querySelector('#login-name'),
  loginPassword: document.querySelector('#login-password'),
  loginSubmit: document.querySelector('#login-form button'),
  loginFeedback: document.querySelector('#login-feedback'),

  registerForm: document.querySelector('#register-form'),
  registerName: document.querySelector('#register-name'),
  registerPassword: document.querySelector('#register-password'),
  registerSubmit: document.querySelector('#register-form button'),
  registerFeedback: document.querySelector('#register-feedback'),

  appView: document.querySelector('#app-view'),
  currentUser: document.querySelector('#current-user'),
  appFeedback: document.querySelector('#app-feedback'),
  logout: document.querySelector('#logout'),

  datePicker: document.querySelector('#date-picker'),
  meta: document.querySelector('#meta'),
  slots: document.querySelector('#slots'),
  users: document.querySelector('#users'),
  events: document.querySelector('#events'),
  eventDate: document.querySelector('#event-date'),
  eventForm: document.querySelector('#event-form'),
  eventAs: document.querySelector('#event-as'),
  eventStart: document.querySelector('#event-start'),
  eventEnd: document.querySelector('#event-end'),
  eventTitle: document.querySelector('#event-title'),
  eventSubmit: document.querySelector('#event-form button'),
  eventFeedback: document.querySelector('#event-feedback'),
}

/**
 * 所有请求都从这里走。它现在做三件事：
 *   1. 后端连不上时也回一个统一形状 —— 页面各处不用各写一遍 try/catch
 *   2. 把统一信封原样交回去 —— 成功读 data、失败读 error / code，由调用方决定
 *   3. **401 全站只在这一处处理**：任何一个接口说「你没登录」，就统一退回登录框
 *
 * 第 3 条是这一版最值得记的一处。如果让每个调用点自己判断 401，
 * 早晚会漏一个，而漏掉的那个会显示「连不上后端」—— 排查方向直接被带偏。
 * 把「认证失败」做成唯一的出口，以后加多少个接口都不用再想这件事。
 *
 * 注意不判断 /api/login 自己的 401：那是 LOGIN_FAILED（密码错），
 * 不是 UNAUTHENTICATED（没登录），按 code 区分，不按状态码。
 */
async function api(url, options) {
  try {
    // 浏览器会自动带上 HttpOnly 的 sid cookie，前端一行都不用写。
    // 这也是为什么用 cookie 而不是把 token 存进 localStorage：
    // 存在 JS 能读到的地方，一次 XSS 就被偷走了。
    const res = await fetch(url, options)
    const body = await res.json()

    if (!body.success && body.code === 'UNAUTHENTICATED') {
      showLogin(body.error || '请先登录')
    }
    return body
  } catch {
    return { success: false, error: '连不上后端：看看窗口 A 是否还在跑', code: 'NETWORK' }
  }
}

/** 提示行统一走这里，各表单各有一行，别各写一套 */
function setFeedback(el, text, isError) {
  el.textContent = text
  el.className = isError ? 'hint error' : 'hint ok'
}

/** 切到登录框。所有「回到未登录」的路径（启动时没登录、会话过期、主动登出）都走它 */
function showLogin(message = '') {
  currentUser = null

  els.boot.hidden = true
  els.appView.hidden = true
  els.loginView.hidden = false

  // 中性样式，不用红色：未登录不是错误，会话过期也不是
  els.loginFeedback.textContent = message
  els.loginFeedback.className = 'hint'
  els.loginPassword.value = ''

  // 顺手清掉上一个人的数据。读接口是公开的，不清的话
  // 下一个人登录前的那一瞬间，屏幕上还留着别人的忙碌时段
  els.slots.innerHTML = ''
  els.meta.textContent = ''
  els.users.innerHTML = ''
  els.events.innerHTML = ''
  els.appFeedback.textContent = '' // 上一个人「已删除」「已注销」的提示也别留给下一个人
}

/** 切到主界面。currentUser 只在这里被赋值，别处只读 */
function enterApp(user) {
  currentUser = user

  els.boot.hidden = true
  els.loginView.hidden = true
  els.appView.hidden = false

  els.currentUser.textContent = user.name
  els.eventAs.textContent = user.name // 录进去的一定是这个人，界面得说实话
  els.loginPassword.value = '' // 密码不该在输入框里多留一秒
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

    const name = document.createElement('span')
    name.textContent = user.name

    item.append(dot, name)

    // 只有自己那一行有按钮，而且它的语义是「注销账号」，不是「删掉这个人」。
    // 系统里没有管理员，所以「删别人」这个动作根本不存在 —— 后端会回 403。
    if (currentUser && user.id === currentUser.id) {
      const del = document.createElement('button')
      del.className = 'del'
      del.textContent = '注销'
      del.addEventListener('click', () => removeSelf(user.name))
      item.appendChild(del)
    }

    els.users.appendChild(item)
  })
}

/**
 * 注销自己的账号。
 *
 * 这不是「删一条记录」那么轻 —— 后端会连带删掉你名下所有忙碌，
 * 而且马上把你登出，所以发请求前先用 confirm 把后果说清楚。
 * 和删忙碌一样：前端这道只是防误点，真正的判断在后端。
 */
async function removeSelf(name) {
  const confirmed = confirm(
    `注销「${name}」这个账号？你名下所有忙碌记录会一起删掉，并且立刻登出。这个操作不可撤销。`,
  )
  if (!confirmed) return

  const body = await api(`/api/users/${currentUser.id}`, { method: 'DELETE' })
  if (!body.success) {
    setFeedback(els.appFeedback, body.error, true)
    return
  }

  // 后端已经把会话划掉了，界面也得回到登录框，否则会停在一个「已经不存在的人」的主界面上
  showLogin('账号已注销')
  els.loginForm.reset()
}

async function loadSlots() {
  const body = await api(slotsUrl())
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
  const body = await api(eventsUrl())
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

    item.append(dot, label)

    // 只给自己的记录画删除按钮。这只是为了界面干净：
    // 真去删别人的，后端会回 403。前端的判断永远只是「建议」，不是权限
    if (currentUser && ev.userId === currentUser.id) {
      const del = document.createElement('button')
      del.className = 'del'
      del.textContent = '删除'
      del.addEventListener('click', () => removeEvent(ev.id))
      item.appendChild(del)
    }

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
  // 标题上的日期和这一轮请求用的是同一天，不会出现「显示 15 号、查的是 16 号」
  els.eventDate.textContent = currentDate()
  return Promise.all([loadUsers(), loadSlots(), loadEvents()])
}

// ---------- 登录 / 登出 ----------

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const name = els.loginName.value.trim()
  const password = els.loginPassword.value

  if (!name || !password) {
    setFeedback(els.loginFeedback, '姓名和密码都要填', true)
    return
  }

  els.loginSubmit.disabled = true
  try {
    const body = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    })

    if (!body.success) {
      setFeedback(els.loginFeedback, body.error, true)
      els.loginPassword.value = '' // 只清密码，姓名留着方便重试
      return
    }

    // 登录成功后后端已经把 sid 写进 cookie 了，前端不需要存任何东西。
    // 这一点常被忽略：换个标签页、刷新页面，登录状态都还在
    enterApp(body.data)
    els.loginForm.reset()
    await refresh()
  } finally {
    els.loginSubmit.disabled = false
  }
})

els.logout.addEventListener('click', async () => {
  // 登出请求失败也要把界面切回登录框：
  // 后端那边会话可能已经没了，把人留在主界面上是更糟的状态
  await api('/api/logout', { method: 'POST' })
  showLogin('已登出')
  els.loginForm.reset()
})

/**
 * 注册 = 自己给自己开户。这是「加成员」现在唯一的入口，放在登录页上。
 *
 * 注册成功后，后端不会替你登录（它只回 201 + User）。所以这里紧接着
 * 用同一份姓名密码调一次 /api/login，用户看起来是「注册完直接进去了」。
 * 这是**前端把两个接口串起来**，而不是后端偷偷多做了一个动作 ——
 * 接口各自只管一件事，才好在别处复用、也才好单独测。
 */
els.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const name = els.registerName.value.trim()
  const password = els.registerPassword.value

  // 前端先挡一次，省一趟往返；后端那两道校验（NAME_EMPTY / 密码长度）照样保留
  if (!name) {
    setFeedback(els.registerFeedback, '名字不能为空', true)
    return
  }
  if (password.length < 6) {
    setFeedback(els.registerFeedback, '密码至少 6 位', true)
    return
  }

  els.registerSubmit.disabled = true
  try {
    const body = await api('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    })

    if (!body.success) {
      setFeedback(els.registerFeedback, body.error, true) // 409 重名也走这儿
      return
    }

    // 第二步：注册成功，马上用同一份凭据登录
    const loginBody = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    })

    if (!loginBody.success) {
      // 账号已经建好了，只是自动登录没成功。这时不能假装成功 ——
      // 把姓名填进登录框，让用户手动登一次
      els.loginName.value = name
      els.registerForm.reset()
      setFeedback(els.loginFeedback, `${body.data.name} 注册成功，请用刚设的密码登录`, false)
      return
    }

    enterApp(loginBody.data)
    els.registerForm.reset()
    els.loginForm.reset()
    await refresh()
  } finally {
    els.registerSubmit.disabled = false // 成功失败都要恢复，否则按钮会一直灰着
  }
})

// ---------- 业务表单 ----------

els.eventForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const startTime = els.eventStart.value
  const endTime = els.eventEnd.value
  const title = els.eventTitle.value.trim()

  // 这几条都是「不值一趟往返」的明显错误；后端照样会再校验一遍
  if (!startTime || !endTime) return setFeedback(els.eventFeedback, '开始和结束时间都要填', true)
  if (startTime >= endTime) return setFeedback(els.eventFeedback, '开始时间必须早于结束时间', true)
  if (!title) return setFeedback(els.eventFeedback, '事由不能为空', true)

  els.eventSubmit.disabled = true
  try {
    const body = await api('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 和 v1.x 唯一的区别就在这一行：body 里没有 userId 了。
      // 谁在录，由后端从会话里取 —— 前端说了不算
      body: JSON.stringify({ date: currentDate(), startTime, endTime, title }),
    })

    if (!body.success) {
      // 409 DUPLICATE_EVENT、400 UNKNOWN_FIELD 都从这儿出来，文案直接用后端的
      setFeedback(els.eventFeedback, body.error, true)
      return
    }

    els.eventTitle.value = '' // 只清事由，时间留着：连着录几条更顺手
    setFeedback(els.eventFeedback, '已录入', false)
    await refresh()
  } finally {
    els.eventSubmit.disabled = false
  }
})

els.datePicker.addEventListener('change', () => {
  // date 输入框允许清空。清空时 `date=` 会被后端判 INVALID_DATE，
  // 这会儿先不请求，等用户选好某天再说 —— 和表单里挡空名字是同一个思路
  if (!currentDate()) return
  refresh()
})

/**
 * 启动顺序：先问「我是谁」，再决定画面。
 *
 * 不能一上来就 refresh()：那会先请求三个读接口（它们是公开的，能成功），
 * 界面闪一下别人的数据，然后才因为未登录被踢回登录框。
 */
async function boot() {
  const body = await api('/api/me')

  // 失败时 api() 已经把界面切到登录框了，这里不用重复处理
  if (!body.success) return

  enterApp(body.data)
  await refresh()
}

boot()
