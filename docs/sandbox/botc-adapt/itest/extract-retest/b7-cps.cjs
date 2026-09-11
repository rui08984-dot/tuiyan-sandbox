'use strict';
const fs = require('fs');
const s = fs.readFileSync('E:/music player/p1b/src/botc/extractPrompt.js', 'utf8');
const lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('BOTC_CARRIER_PREFIX = ') || lines[i].includes('m + 1') || lines[i].includes('indexOf(BOTC_CARRIER_PREFIX)')) {
    const cps = [...lines[i]].map(c => c.codePointAt(0).toString(16)).filter(c => parseInt(c,16) > 0x2000).join(',');
    console.log('L' + (i+1) + ': ' + JSON.stringify(lines[i].slice(0, 90)) + '  hi-cps=[' + cps + ']');
  }
}