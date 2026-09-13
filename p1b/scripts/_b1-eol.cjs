'use strict';
const fs = require('fs');
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f); let crlf = 0, lf = 0;
  for (let i = 0; i < b.length; i++) { if (b[i] === 10) { if (i > 0 && b[i - 1] === 13) crlf++; else lf++; } }
  console.log((crlf ? 'CRLF' : 'LF  ') + ' crlf=' + crlf + ' lf=' + lf + '  ' + f);
}