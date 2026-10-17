// pages/records/records.js —— 记录表格页的逻辑

Page({
  data: {
    records: [] // 全部番茄记录，每一条：{ startText, durationText, task }
  },

  onShow() {
    // 每次打开这个页面都重新读一次记录（可能有新完成的番茄）
    this.loadRecords()
  },

  // 读取本地保存的记录
  loadRecords() {
    this.setData({ records: wx.getStorageSync('pomodoroRecords') || [] })
  },

  // 导出成 Excel 能打开的文件
  exportCsv() {
    const records = this.data.records
    if (records.length === 0) {
      wx.showToast({ title: '还没有记录', icon: 'none' })
      return
    }

    // 拼出 CSV 文本；开头的 ﻿ 是 BOM 头，防止 Excel 打开中文乱码
    let csv = '﻿开始时间（北京时间）,计时时长,做的事情\n'
    records.forEach((r) => {
      csv += `${r.startText},${r.durationText},${r.task}\n`
    })

    // 把 CSV 保存成文件，再通过微信分享发出去
    const filePath = `${wx.env.USER_DATA_PATH}/pomodoro-records.csv`
    const fs = wx.getFileSystemManager()
    try {
      fs.writeFileSync(filePath, csv, 'utf8')
      wx.shareFileMessage({
        filePath,
        fileName: '番茄时钟记录.csv',
        success() {
          wx.showToast({ title: '请选择"文件传输助手"发送', icon: 'none' })
        },
        fail() {
          // 分享失败时，退而求其次：复制到剪贴板
          wx.setClipboardData({
            data: csv,
            success() { wx.showToast({ title: '已复制，粘贴到 Excel 即可', icon: 'none' }) }
          })
        }
      })
    } catch (e) {
      wx.setClipboardData({
        data: csv,
        success() { wx.showToast({ title: '已复制，粘贴到 Excel 即可', icon: 'none' }) }
      })
    }
  },

  // 清空全部记录
  clearAll() {
    wx.showModal({
      title: '清空记录',
      content: '确定要删除全部记录吗？删除后无法恢复。',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('pomodoroRecords')
          this.loadRecords()
        }
      }
    })
  }
})
