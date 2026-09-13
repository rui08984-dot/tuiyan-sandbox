
const CWL_PATH = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30';
const DLT_PATH = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=60&isVerify=1&pageNo=1';
async function refreshCals() {
  try {
    const j = await fetchRetry(() => getJson(CWL_PATH), 3, 'cwl');
    const list = (j.result || []).slice().sort((a, b) => Number(b.code) - Number(a.code));
    if (list[0] && list[0].code) { CALS.cwl.latestCode = String(list[0].code); CALS.cwl.latestDate = dateOf(list[0].date); }
  } catch (e) { log('WARN cwl 日历刷新失败（沿用内置锚 ' + CALS.cwl.latestCode + '@' + CALS.cwl.latestDate + '）: ' + e.message); }
  try {
    const j = await fetchRetry(() => getJson(DLT_PATH), 3, 'dlt');
    const list = ((j.value && j.value.list) || []).slice().sort((a, b) => Number(b.lotteryDrawNum) - Number(a.lotteryDrawNum));
    if (list[0] && list[0].lotteryDrawNum) { CALS.dlt.latestCode = String(list[0].lotteryDrawNum); CALS.dlt.latestDate = dateOf(list[0].lotteryDrawTime); }
  } catch (e) { log('WARN dlt 日历刷新失败（沿用内置锚 ' + CALS.dlt.latestCode + '@' + CALS.dlt.latestDate + '）: ' + e.message); }
  log('日历锚刷新：ssq ' + CALS.cwl.latestCode + '@' + CALS.cwl.latestDate + ' | dlt ' + CALS.dlt.latestCode + '@' + CALS.dlt.latestDate);
}
async function evalRow(r) {
  const k = String(r.kind || '');
  const pre = preScreen(r);
  if (pre) return { pending: pre, prescreened: true };
  if (BASE && typeof BASE[k] === 'function') return await BASE[k](r);
  if (typeof B3[k] === 'function') return await B3[k](r);
  return { unsupported: '无对应 resolver（kind=' + k + '，corpus-resolve 与 daemon 均无）' };
}
