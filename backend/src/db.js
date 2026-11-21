/**
 * 数据库连接：只此一处。
 *
 * 为什么单独一个文件，而不是写在 data.js 顶上：
 * 「怎么连」和「存什么」是两件事。以后换连接池参数、加 SSL、换云数据库，
 * 只动这里；data.js 里的 SQL 一个字不用改。
 *
 * 为什么用连接池（Pool）而不是单个 Client：
 * 每个请求新建一条连接，并发一高就把数据库的连接数打满；
 * 池子把连接复用起来，用完还回去。这是服务端连库的标准做法。
 */

const path = require('path')

// 指定 .env 的绝对路径，不依赖启动时的工作目录。
// 写成 require('dotenv').config() 的话，从别的目录启动后端就找不到 .env 了。
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// 池子的错误不会自动冒到某个请求里，不接住会静默消失，排查时毫无线索
pool.on('error', (err) => {
  console.error('数据库连接池出错：', err.message)
})

/** 所有 SQL 都从这里出去：以后加慢查询日志、加事务，也只改这一处 */
function query(text, params) {
  return pool.query(text, params)
}

module.exports = { query, pool }
