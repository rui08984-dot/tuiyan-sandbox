'use strict';
/**
 * p1b/src/deps.js —— 引擎复用唯一入口（施工铁律：require p1a-terminal 模块，零复制零修改）。
 * p1a-terminal/src/db.js（契约 v1 对象式接口）/ engine.js（纯代码比对器）/ llm.js（C 路 LLM 适配）。
 * 任何 p1b 模块不得绕过本文件直接 require p1a 源码，便于将来换路径/加 mock 层。
 */
const path = require('path');

const P1A_ROOT = path.join(__dirname, '..', '..', 'p1a-terminal');

const db = require(path.join(P1A_ROOT, 'src', 'db'));
const llm = require(path.join(P1A_ROOT, 'src', 'llm'));
const engine = require(path.join(P1A_ROOT, 'src', 'engine'));

module.exports = { db, llm, engine, P1A_ROOT };
