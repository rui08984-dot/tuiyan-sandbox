'use strict';
const o = require('E:/music player/p1b/sim/out/r5-kind-samples.json');
const ks = Object.keys(o);
ks.forEach((k, i) => console.log(i + '\t' + k));
console.log('=== 15..28 ===');
ks.slice(15, 28).forEach((k) => console.log(k + ' :: ' + JSON.stringify(o[k].resolve)));
