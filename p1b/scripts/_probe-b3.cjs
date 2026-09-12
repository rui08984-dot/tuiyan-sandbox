const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
async function get(name,url,opt={}){
  const t0=Date.now();
  try{
    const c=new AbortController();const to=setTimeout(()=>c.abort(),25000);
    const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json, text/csv, */*',...(opt.headers||{})},signal:c.signal});
    const txt=await r.text();clearTimeout(to);
    let shape='';
    try{const j=JSON.parse(txt);shape=JSON.stringify(j).slice(0,300);}catch(e){shape=txt.slice(0,150).replace(/\s+/g,' ');}
    console.log('['+name+'] HTTP '+r.status+' '+(Date.now()-t0)+'ms len='+txt.length);
    console.log('   url: '+url);
    console.log('   body: '+shape);
    return {name,status:r.status,text:txt};
  }catch(e){
    console.log('['+name+'] ERR '+e.name+' '+e.message);
    console.log('   url: '+url);
    return {name,status:0,text:''};
  }
}
const P=[
 ['AQ-om-pm10','https://air-quality-api.open-meteo.com/v1/air-quality?latitude=52.52&longitude=13.41&hourly=pm10&past_days=3&forecast_days=1'],
 ['AQ-om-pm25','https://air-quality-api.open-meteo.com/v1/air-quality?latitude=40.71&longitude=-74.01&hourly=pm2_5,pm10&past_days=2&forecast_days=2'],
 ['AQ-cams','https://air-quality-api.open-meteo.com/v1/air-quality?latitude=52.52&longitude=13.41&hourly=pm10&domains=cams_global&past_days=1'],
 ['CG-simple','https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd'],
 ['CG-mktchart','https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=daily'],
 ['Binance-price','https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'],
 ['Binance-klines','https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=10'],
 ['Wiki-pv','https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/Albert_Einstein/daily/2025010100/2025011000'],
 ['GH-node','https://api.github.com/repos/nodejs/node'],
 ['GH-search','https://api.github.com/search/repositories?q=stars:%3E50000&sort=stars&per_page=2'],
 ['Stooq-spx','https://stooq.com/q/d/l/?s=%5Espx&i=d'],
 ['Stooq-aapl','https://stooq.com/q/d/l/?s=aapl.us&i=d'],
 ['Yahoo-AAPL','https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1mo&interval=1d'],
 ['DBn-ECB-EXR','https://api.db.nomics.world/v22/series/ECB/EXR?limit=2&observations=1'],
 ['DBn-BIS','https://api.db.nomics.world/v22/series/BIS/WS_EER?limit=2&observations=1'],
 ['DBn-IMF','https://api.db.nomics.world/v22/series/IMF/WEO:2024-10?limit=2&observations=1'],
 ['Frankfurter','https://api.frankfurter.app/latest?from=USD'],
 ['NPM-dl','https://api.npmjs.org/downloads/point/last-week/react'],
 ['PyPI-stats','https://pypistats.org/api/packages/requests/recent'],
 ['arXiv-q','http://export.arxiv.org/api/query?search_query=cat:cs.AI&max_results=2'],
 ['Polymarket','https://gamma-api.polymarket.com/markets?closed=false&limit=2'],
 ['USGS-quake','https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2025-01-01&minmagnitude=6'],
 ['OM-hist-weather','https://archive-api.open-meteo.com/v1/archive?latitude=52.52&longitude=13.41&start_date=2024-01-01&end_date=2024-01-05&daily=temperature_2m_max'],
 ['OM-climate','https://climate-api.open-meteo.com/v1/climate?latitude=52.52&longitude=13.41&start_date=2020-01-01&end_date=2020-12-31&models=MRI_AGCM3_2_S&daily=temperature_2m_max'],
 ['WorldBank','https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=5&date=2018:2023'],
];
(async()=>{const fs=require('fs');const res=[];for(const [n,u] of P){res.push(await get(n,u));}
fs.writeFileSync('p1b/scripts/_probe-b3.raw.json',JSON.stringify(res.map(r=>({n:r.name,s:r.status,t:r.text.slice(0,1200)}))));
console.log('=== DONE '+res.filter(r=>r.status===200).length+'/26 ok');})();
