// 量化 UTC 日过滤造成的偏差：对 fr/es 各取一 type，比较「UTC日过滤（现行）」vs「全窗口（本地日全量）」
const FETCH_MS=25000;
async function getJson(u){const ac=new AbortController();const t=setTimeout(()=>ac.abort(),FETCH_MS);try{const r=await fetch(u,{signal:ac.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(t);}}
(async()=>{
  for(const [cc,ty] of [['fr','Solar'],['es','Solar']]){
    const url='https://api.energy-charts.info/public_power?country='+cc+'&start=2026-06-25&end=2026-06-25';
    const j=await getJson(url);
    const ts=j.unix_seconds||[]; const tp=(j.production_types||[]).filter(x=>x.name===ty)[0];
    // 现行口径：按 UTC 日 == '2026-06-25' 过滤
    let s1=0,n1=0; ts.forEach((sec,i)=>{ if(new Date(sec*1000).toISOString().slice(0,10)!=='2026-06-25')return; const v=tp.data[i]; if(v==null||!isFinite(v))return; s1+=Number(v); n1++; });
    // 全窗口口径：API 用 start=end=该日 已按本地日返回
    let s2=0,n2=0; ts.forEach((sec,i)=>{ const v=tp.data[i]; if(v==null||!isFinite(v))return; s2+=Number(v); n2++; });
    console.log(cc+' '+ty+': 现行(UTC过滤) n='+n1+' mean='+(s1/n1).toFixed(4)+'  |  全窗口 n='+n2+' mean='+(s2/n2).toFixed(4)+'  |  差='+((s2/n2)-(s1/n1)).toFixed(4)+' ('+(((s2/n2)-(s1/n1))/(s1/n1)*100).toFixed(2)+'%)');
  }
})();
