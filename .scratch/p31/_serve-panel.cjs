'use strict';
// 临时静态服务：把工作区根目录暴露到 127.0.0.1:8899（只读，仅本次查看面板用）
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = 'E:/music player';
const CT = {
  '.html': 'text/html;charset=utf-8',
  '.md': 'text/plain;charset=utf-8',
  '.mmd': 'text/plain;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.js': 'application/javascript;charset=utf-8',
  '.svg': 'image/svg+xml',
};
http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/dashboard.html';
  const p = path.join(ROOT, rel);
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain;charset=utf-8' }); res.end('not found: ' + rel); return; }
    res.writeHead(200, { 'Content-Type': CT[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(8899, '127.0.0.1', () => console.log('listening on http://127.0.0.1:8899/'));
