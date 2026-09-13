
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const urls = [
 ['cwl-noheader','https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=5', {}],
 ['cwl-ua','https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=5', {'User-Agent':UA}],
 ['cwl-full','https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=5', {'User-Agent':UA,Referer:'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/'}],
 ['dlt-noheader','https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=5&isVerify=1&pageNo=1', {}],
 ['dlt-full','https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=5&isVerify=1&pageNo=1', {'User-Agent':UA,Referer:'https://static.sporttery.cn/'}],
];
(async()=>{ for(const [l,u,h] of urls){ try{ const r=await fetch(u,{headers:h}); const t=await r.text(); let extra=''; try{const j=JSON.parse(t); extra = (j.result&&j.result[0]&&j.result[0].code)||((j.value&&j.value.list&&j.value.list[0].lotteryDrawNum)||''); }catch(e){} console.log(l, r.status, 'len='+t.length, 'sample='+extra);}catch(e){console.log(l,'FAIL',e.message);} } })();