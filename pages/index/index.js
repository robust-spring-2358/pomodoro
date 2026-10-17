// pages/index/index.js —— 番茄时钟的核心逻辑

// 休息模式的固定时长（单位：秒），想改休息时长改这里
const BREAK_DURATIONS = {
  shortBreak: 10 * 60, // 短休息：10 分钟
  longBreak: 15 * 60   // 长休息：15 分钟
}

// 可自选的工作时长（分钟），想增减选项改这里
const MINUTE_OPTIONS = [3, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

// 各模式显示在圆环里的文字
const MODE_TEXT = {
  work: '专注工作',
  shortBreak: '短休息',
  longBreak: '长休息'
}

// 各模式圆环的颜色，想改颜色改这里
const MODE_COLOR = {
  work: '#ff6b6b',       // 红色
  shortBreak: '#4ecdc4', // 青色
  longBreak: '#45b7d1'   // 蓝色
}

// 把时间戳格式化成北京时间文字（不管手机时区怎么设，都按北京时间算）
function formatBeijingTime(ts) {
  // 加 8 小时后再用 UTC 方法读，得到的就是北京时间
  const d = new Date(ts + 8 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

Page({
  data: {
    mode: 'work',          // 当前模式：work / shortBreak / longBreak
    modeText: '专注工作',   // 显示在圆环里的文字
    timeText: '40:00',     // 显示的时间（初始值，打开页面后会自动刷新成正确时间）
    isRunning: false,      // 是否正在计时
    todayCount: 0,         // 今天完成的番茄数
    totalCount: 0,         // 累计完成的番茄数
    taskOptions: ['数学作业', '语文作业', '英语作业', '书法', '游戏', '读书'], // 下拉选项
    taskIndex: 0,          // 当前选中第几个选项
    minuteOptions: MINUTE_OPTIONS, // 可选时长列表
    minuteIndex: 8,        // 默认选第 8 个 = 40 分钟
    workMinutes: 40        // 工作倒计时当前时长（分钟）
  },

  onLoad() {
    // 读取本地保存的统计数据
    this.loadStats()
    // 初始化计时状态，防止第一次点"开始"时出错
    this.setMode('work')
  },

  onReady() {
    // 页面渲染完成后，初始化画布（用来画圆环）
    this.initCanvas()
  },

  onShow() {
    // 从后台回到小程序时，校准一次时间（防止切出去之后时间不准）
    if (this.isRunning && this.endTime) {
      const remaining = this.endTime - Date.now()
      if (remaining <= 0) {
        this.finishTimer()
      } else {
        this.updateDisplay(remaining)
      }
    }
  },

  // 初始化圆环画布
  initCanvas() {
    wx.createSelectorQuery()
      .select('#progressCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        // 按屏幕像素比放大画布，防止圆环模糊
        const dpr = wx.getSystemInfoSync().pixelRatio
        canvas.width = res[0].width * dpr
        canvas.height = res[0].height * dpr
        ctx.scale(dpr, dpr)
        this.canvasWidth = res[0].width
        this.ctx = ctx
        this.drawRing(1) // 先画一个完整的圆环
      })
  },

  // 画进度圆环，progress 是剩余比例（0 ~ 1）
  drawRing(progress) {
    const ctx = this.ctx
    if (!ctx) return
    const size = this.canvasWidth
    const center = size / 2
    const radius = size / 2 - 16

    ctx.clearRect(0, 0, size, size)

    // 1. 灰色的底环
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.strokeStyle = '#eef0f5'
    ctx.lineWidth = 14
    ctx.stroke()

    // 2. 彩色的进度环（从顶部开始，顺时针画）
    if (progress > 0) {
      ctx.beginPath()
      ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
      ctx.strokeStyle = MODE_COLOR[this.data.mode]
      ctx.lineWidth = 14
      ctx.lineCap = 'round'
      ctx.stroke()
    }
  },

  // 切换模式（点击顶部的三个标签）
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.stopTick()
    this.setMode(mode)
  },

  // 选择本次要做的事情（下拉框）
  onTaskChange(e) {
    this.setData({ taskIndex: Number(e.detail.value) })
  },

  // 选择倒计时时长（下拉框）
  onMinuteChange(e) {
    const index = Number(e.detail.value)
    this.setData({ minuteIndex: index, workMinutes: this.data.minuteOptions[index] })
    // 如果当前是工作模式，就把时间重置成新选的时长；休息模式不受影响
    if (this.data.mode === 'work') {
      this.stopTick()
      this.setMode('work')
    }
  },

  // 计算某个模式的时长（毫秒）：工作模式用自己选的分钟数，休息模式用固定时长
  durationOf(mode) {
    if (mode === 'work') return this.data.workMinutes * 60 * 1000
    return BREAK_DURATIONS[mode] * 1000
  },

  // 设置模式，并把时间重置到该模式的时长
  setMode(mode) {
    this.remainingMs = this.durationOf(mode)
    this.setData({ mode, modeText: MODE_TEXT[mode], isRunning: false })
    this.updateDisplay(this.remainingMs)
  },

  // 开始 / 暂停（同一个按钮）
  toggleTimer() {
    if (this.isRunning) {
      this.pauseTimer()
    } else {
      this.startTimer()
    }
  },

  // 开始计时
  startTimer() {
    // 记住"结束时间点"，这样切到后台再回来时间也不会错
    this.endTime = Date.now() + this.remainingMs
    this.sessionStartTime = Date.now() // 记住这次开始的时间，用于写记录
    this.isRunning = true
    this.setData({ isRunning: true })
    // 每 250 毫秒刷新一次，圆环转动更流畅
    this.timer = setInterval(() => this.tick(), 250)
  },

  // 暂停计时
  pauseTimer() {
    this.remainingMs = Math.max(0, this.endTime - Date.now())
    this.stopTick()
    this.isRunning = false
    this.setData({ isRunning: false })
  },

  // 重置时间
  resetTimer() {
    this.stopTick()
    this.setMode(this.data.mode)
  },

  // 每一跳：计算剩余时间并更新界面
  tick() {
    const remaining = Math.max(0, this.endTime - Date.now())
    this.updateDisplay(remaining)
    if (remaining <= 0) {
      this.finishTimer()
    }
  },

  // 更新显示：时间文字 + 圆环
  updateDisplay(remainingMs) {
    const totalMs = this.durationOf(this.data.mode)
    const secs = Math.ceil(remainingMs / 1000)
    const m = Math.floor(secs / 60)
    const s = secs % 60
    const timeText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    this.setData({ timeText })
    this.drawRing(remainingMs / totalMs)
  },

  // 停止计时器
  stopTick() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  // 倒计时结束
  finishTimer() {
    this.stopTick()
    this.isRunning = false
    this.setData({ isRunning: false })
    this.remainingMs = 0

    wx.vibrateLong() // 手机震动提醒

    if (this.data.mode === 'work') {
      // 工作结束：番茄数 +1，自动进入休息
      this.addCount()
      this.saveRecord() // 把这次番茄写进记录表格
      this.pomodoroCycle = (this.pomodoroCycle || 0) + 1
      const next = this.pomodoroCycle % 4 === 0 ? 'longBreak' : 'shortBreak'
      wx.showModal({
        title: '工作完成！',
        content: next === 'longBreak' ? '已经完成 4 个番茄啦，好好休息一下～' : '干得漂亮！休息一下吧～',
        showCancel: false,
        confirmText: '好的'
      })
      this.setMode(next)
    } else {
      // 休息结束：回到工作模式
      wx.showModal({
        title: '休息结束',
        content: '满血复活，开始新的番茄吧！',
        showCancel: false,
        confirmText: '好的'
      })
      this.setMode('work')
    }
  },

  // 番茄数 +1，并保存到本地
  addCount() {
    const d = new Date()
    const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const stats = wx.getStorageSync('pomodoroStats') || {}
    // 如果保存的不是今天的记录，先把今日数量清零
    const todayCount = stats.date === today ? (stats.todayCount || 0) + 1 : 1
    const totalCount = (stats.totalCount || 0) + 1
    wx.setStorageSync('pomodoroStats', { date: today, todayCount, totalCount })
    this.setData({ todayCount, totalCount })
  },

  // 把这次完成的番茄记到"记录"表格里
  saveRecord() {
    const records = wx.getStorageSync('pomodoroRecords') || []
    records.push({
      startText: formatBeijingTime(this.sessionStartTime || Date.now() - this.data.workMinutes * 60 * 1000), // 开始时间（北京时间）
      durationText: `${this.data.workMinutes} 分钟`, // 计时时长
      task: this.data.taskOptions[this.data.taskIndex] // 做的事情
    })
    wx.setStorageSync('pomodoroRecords', records)
  },

  // 读取本地保存的统计数据
  loadStats() {
    const stats = wx.getStorageSync('pomodoroStats') || {}
    const d = new Date()
    const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const todayCount = stats.date === today ? stats.todayCount || 0 : 0
    this.setData({ todayCount, totalCount: stats.totalCount || 0 })
  }
})
