#!/usr/bin/env node
'use strict';
/**
 * 局鉴 · bin/jujian-mcp.cjs —— MCP server（stdio）
 *
 *   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node bin/jujian-mcp.cjs
 *
 * 手测：
 *   1) 列工具   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node bin/jujian-mcp.cjs
 *   2) 读局     echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"jujian_list_games"}}' | node bin/jujian-mcp.cjs
 *   3) 起草     echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"jujian_record_claim","arguments":{"game_id":1,"kind":"claim_role","seat":3,"argument":"预言家","day":1}}}' | node bin/jujian-mcp.cjs
 *
 * ── 两条纪律 ──────────────────────────────────────────────────────────────
 *  ① **stdout 只出协议报文**：任何日志都走 stderr。
 *     往 stdout 打一行「连接成功」就会让客户端的解析器崩在莫名其妙的地方。
 *  ② **一个字节都不写账本**：这个 server 的写意图工具只起草（见 src/mcp/tools.cjs 头注）。
 */

const fs = require('node:fs');
const path = require('node:path');

const store = require('../src/db/store');
const { readLines, parseLine, makeWriter, JSONRPC_ERRORS: E } = require('../src/mcp/framing.cjs');
const { handleMessage } = require('../src/mcp/protocol.cjs');

function main() {
  const dbPath = process.env.JUJIAN_DB || store.DEFAULT_DB_PATH;
  store.init(dbPath);

  const write = makeWriter(process.stdout);
  const { JSONRPC_ERRORS: _E } = { JSONRPC_ERRORS: E };
  readLines(process.stdin, (line) => {
    const p = parseLine(line);
    if (!p.ok) {
      write({ jsonrpc: '2.0', id: null, error: { code: E.PARSE_ERROR, message: '这一行不是合法 JSON：' + p.error } });
      return;
    }
    const res = handleMessage(p.value);
    if (res === null) return;   // 通知不回
    write(res);
  });

  process.stderr.write('局鉴 MCP server 已起（stdio）· 库 ' + dbPath
    + ' · ' + require('../src/mcp/tools.cjs').ALL.length + ' 个工具'
    + '（5 读 ＋ 3 只起草；本 server 不写账本）\n');
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write('局鉴 MCP server 启动失败：' + (e && e.stack ? e.stack : e.message) + '\n');
    process.exit(1);
  }
}

module.exports = { main };