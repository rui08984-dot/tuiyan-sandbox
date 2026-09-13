'use strict';
const fs=require('fs');const path=require('path');
const f=path.join(__dirname,'..','sim','out','corpus-sources-b3.rows.json');
const rows=JSON.parse(fs.readFileSync(f,'utf8'));
console.log('rows='+rows.length);
const byKind={},byPhase={};
rows.forEach(r=>{const k=(r.resolve&&r.resolve.kind)||'NO_KIND';byKind[k]=(byKind[k]||0)+1;byPhase[r.phase+'|'+k]=(byPhase[r.phase+'|'+k]||0)+1;});
console.log('KINDS='+JSON.stringify(byKind,null,1));
console.log('BYPHASE='+JSON.stringify(byPhase,null,1));
// sample resolve params per kind
const seen={};
rows.forEach(r=>{const k=(r.resolve&&r.resolve.kind)||'NO_KIND';if(seen[k])return;seen[k]=1;console.log('== '+k+' ==');console.log(JSON.stringify(r.resolve));console.log('gameType='+r.gameType+' phase='+r.phase);});
