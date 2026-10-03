#!/usr/bin/env node
'use strict';
/**
 * 局鉴 · bin/jujian-bench.cjs —— 真实对局盲测（命令行入口）
 *
 *   jujian-bench              人读报告
 *   jujian-bench --json       机器读（CI / 后续人工判定的输入）
 *
 * 它把 `docs/sandbox/p0-replay/` 那 5 局真实对局的双层档案跑成可复跑的读数。
 * ★零网络、逐条可复核。退出码非零表示 bench 自己没跑起来（不是「没发现矛盾」）。
 */

const bench = require('../bench/run-bench.cjs');

function main() {
  const asJson = process.argv.includes('--json');
  let report;
  try {
    report = bench.runAll();
  } catch (e) {
    process.stderr.write('bench 没能跑起来：\n' + (e && e.message ? e.message : String(e)) + '\n');
    return 2;
  }
  if (asJson) {
    process.stdout.write(JSON.stringify({
      tool: 'jujian-bench',
      scope: {
        measures: ['M1 矛盾检出', 'M2 矛盾与真狼的关系', 'H2 引用真实性', 'H2\' RD1 守卫', 'COV 抽取覆盖率'],
        does_not_measure: ['抽取质量（本 bench 用规则适配器，非产品 LLM 抽取）',
          '嫌疑排序是否优于基线（预注册协议已判负）', '矛盾有效率（需人工抽查）'],
      },
      results: report.results,
      skipped: report.skipped,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(bench.render(report));
  }
  return 0;
}

process.exit(main());