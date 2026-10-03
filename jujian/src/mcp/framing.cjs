'use strict';
/**
 * 局鉴 · src/mcp/framing.cjs —— stdio 上的行分帧与写序列化。
 *
 * ── 为什么按行 ────────────────────────────────────────────────────────────
 *  MCP stdio 传输的报文是**一行一个 JSON 对象**（Content-Length 头是旧 HTTP+SSE 时代的做法，
 *  2026-07-28 修订版已不是它）。按行切分让本层不需要维护半包状态机之外的东西，
 *  也让 `echo '{"jsonrpc":"2.0",...}' | node bin/jujian-mcp.cjs` 这种手测能直接跑通。
 *
 * ── 为什么写要串行化 ──────────────────────────────────────────────────────
 *  `process.stdout` 写管道时**不保证一次 write 对应一次读**（超过 64KB 会被内核拆段）。
 *  两个并发 write 的 JSON 行一旦交错，客户端就再也解析不出来，且症状是「偶尔丢一条消息」
 *  —— 极难查。所以本件把所有写排进一条 Promise 链，**一行一个 write，且前一行写完才写下一行**。
 *
 *  —— 这里的「为什么」有一条不能省：MCP 的 tools/call 可能被并发调用（客户端不一定串行），
 *  而每个 tools/call 内部是 spawnSync（同步阻塞），所以单进程内天然不会重入；
 *  但 `framing` 仍要独立保证写入原子性，因为**测试会并发喂消息**，server 未来也可能有异步路径。
 */

const JSONRPC_ERRORS = { PARSE_ERROR: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL_ERROR: -32603 };

/**
 * 把一个 stdin 流切成「一行一个 JSON」的消息，逐条喂给 onMessage。
 *
 * @param {import('stream').Readable} stream
 * @param {(line:string)=>void} onLine  每收到一整行（非空）调一次
 */
function readLines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');   // 容忍 CRLF：Windows 客户端会发它
      buf = buf.slice(i + 1);
      if (line.trim()) onLine(line);
    }
  });
  return () => buf;   // 供测试读「未闭合的残余」
}

/** 解析一行 JSON。坏行不抛给调用方，返回 {ok:false,error} 让上层回 -32700。 */
function parseLine(line) {
  try { return { ok: true, value: JSON.parse(line) }; }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
}

/** 串行写：所有行排进同一条链，保证不交错。 */
function makeWriter(out) {
  let chain = Promise.resolve();
  const write = (obj) => {
    chain = chain.then(() => new Promise((resolve) => {
      const s = JSON.stringify(obj) + '\n';
      if (!out.write(s)) out.once('drain', resolve);   // 背压：内核满了要等 drain，不能硬塞下一行
      else resolve();
    }));
    return chain;
  };
  write.idle = () => chain;
  return write;
}

module.exports = { readLines, parseLine, makeWriter, JSONRPC_ERRORS };
