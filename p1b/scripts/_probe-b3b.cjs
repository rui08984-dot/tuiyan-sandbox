const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
async function get(name,url,opt={}){
  for(let a=0;a<2;a++){
    const t0=Date.now();
    try{
      const c=new AbortController();const to=setTimeout(()=>c.abort(),25000);
      const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json, text/csv, */*',...(opt.headers||{})},signal:c.signal});
      const txt=await r.text();clearTimeout(to);
      let shape='';try{shape=JSON.stringify(JSON.parse(txt)).slice(0,260);}catch(e){shape=txt.slice(0,140).replace(/\s+/g,' ');}
      console.log('['+name+'] HTTP '+r.status+' '+(Date.now()-t0)+'ms len='+txt.length);
      console.log('   '+url);
      console.log('   '+shape);
      return {n:name,s:r.status,t:txt.slice(0,1500)};
    }catch(e){if(a===1){console.log('['+name+'] ERR '+e.message+' | '+url);return {n:name,s:0,t:e.message};} await new Promise(r=>setTimeout(r,1200));}
  }
}
const P=[
 ['Coinbase-spot','https://api.coinbase.com/v2/prices/BTC-USD/spot'],
 ['Kraken','https://api.kraken.com/0/public/Ticker?pair=XBTUSD'],
 ['CoinPaprika','https://api.coinpaprika.com/v1/tickers/btc-bitcoin'],
 ['CryptoCompare','https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD'],
 ['Bitstamp','https://www.bitstamp.net/api/v2/ticker/btcusd/'],
 ['Binance-retry','https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'],
 ['Binance-data','https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=5'],
 ['OKX','https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT'],
 ['CG-retry','https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'],
 ['DBn-ECB-ds','https://api.db.nomics.world/v22/datasets/ECB/EXR'],
 ['DBn-ECB-serie','https://api.db.nomics.world/v22/series/ECB/EXR/M.USD.EUR.SP00.A?observations=1'],
 ['DBn-ECB-prov','https://api.db.nomics.world/v22/providers/ECB'],
 ['DBn-Eurostat','https://api.db.nomics.world/v22/series/Eurostat/une_rt_m?limit=1&observations=1'],
 ['DBn-OECD','https://api.db.nomics.world/v22/series/OECD/MEI?limit=1&observations=1'],
 ['DBn-WB','https://api.db.nomics.world/v22/series/WB/WDI?limit=1&observations=1'],
 ['Stooq-pl','https://stooq.pl/q/d/l/?s=aapl.us&i=d'],
 ['Nasdaq-api','https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks'],
 ['CNBC-quote','https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=AAPL&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1'],
 ['FRED-csv','https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500'],
 ['SEC-EDGAR','https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json'],
 ['OpenMeteo-flood','https://flood-api.open-meteo.com/v1/flood?latitude=52.52&longitude=13.41&daily=river_discharge&past_days=5&forecast_days=3'],
 ['OM-air-history','https://air-quality-api.open-meteo.com/v1/air-quality?latitude=52.52&longitude=13.41&hourly=pm10&past_days=30&forecast_days=1'],
 ['Wiki-pv-top','https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2025/01/01'],
 ['Wiki-edit','https://api.wikimedia.org/core/v1/wikipedia/en/page/Albert_Einstein/history'],
 ['GH-rate','https://api.github.com/rate_limit'],
 ['PyPI-retry','https://pypi.org/pypi/requests/json'],
 ['NPM-reg','https://registry.npmjs.org/react'],
 ['HackerNews','https://hacker-news.firebaseio.com/v0/topstories.json'],
 ['OpenLibrary','https://openlibrary.org/search.json?q=lord+of+the+rings&limit=1'],
 ['GoogleTrends?','https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=0'],
 ['CoinGecko-pro','https://pro-api.coingecko.com/api/v3/ping'],
 ['DefiLlama','https://api.llama.fi/v2/chains'],
 ['AlphaV','https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=demo'],
 ['TwelveData','https://api.twelvedata.com/price?symbol=AAPL&apikey=demo'],
];
(async()=>{const fs=require('fs');const res=[];for(const [n,u] of P){const r=await get(n,u);if(r)res.push(r);}
fs.writeFileSync('p1b/scripts/_probe-b3b.raw.json',JSON.stringify(res));
console.log('=== OK '+res.filter(r=>r.s===200).length+'/'+res.length);})();
