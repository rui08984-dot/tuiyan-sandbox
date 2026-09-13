
// ── CLI 子命令：--report-due（只读，打印到期分布并落盘 JSON）──
async function reportDue() {
  const d = distribute();
  console.log('未解题总数=' + d.rows + '（可定到期 ' + (d.rows - d.undatable) + ' / 无法定到期 ' + d.undatable + '）');
  console.log('\n[按日]');
  Object.keys(d.byDay).sort().forEach((k) => console.log('  ' + k + '  ' + String(d.byDay[k]).padStart(3) + ' 条'));
  console.log('\n[按月]');
  Object.keys(d.byMonth).sort().forEach((k) => console.log('  ' + k + '  ' + String(d.byMonth[k]).padStart(3) + ' 条'));
  console.log('\n[到期日来源] ' + JSON.stringify(d.bySrc));
  console.log('[按 kind] ' + JSON.stringify(d.byKind));
  console.log('[无法定到期] ' + d.undatable + ' ' + JSON.stringify(d.undKinds));
  const p = path.join(ROOT, 'p1b', 'sim', 'out', 'resolve-daemon.due.json');
  fs.writeFileSync(p, JSON.stringify({ generated_at: ts(), today: today(), ...d }, null, 1), 'utf8');
  console.log('\n已落盘 ' + p);
}
