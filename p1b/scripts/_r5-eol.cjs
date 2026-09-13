'use strict';
const fs = require('fs');
for (const f of ['p1b/scripts/corpus-resolve.cjs','p1b/scripts/corpus-resolve-daemon.cjs','p1b/scripts/corpus-sources-b4.cjs','p1b/src/db/predictionsStore.js']) {
  const b = fs.readFileSync(f);
  const crlf = (b.toString('utf8').match(/\r\n/g) || []).length;
  const lf = (b.toString('utf8').match(/\n/g) || []).length;
  console.log(f + ' bytes=' + b.length + ' crlf=' + crlf + ' lf=' + lf + ' => ' + (crlf > 0 ? 'CRLF' : 'LF'));
}
