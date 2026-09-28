'use strict';
/**
 * p1b/test/matures-at-year.test.cjs —— 年度题到期日口径回归锁（**写读双端**）
 *
 * 病象（两端各一，方向相反）：
 *   ① 写端口 `p1b/src/db/predictionsStore.js` 的 year 分支写 `String(r.year) + '-12-31'`
 *      ⇒ 输入 2027 落 `2027-12-31`，**早了一整年**；到期日是结算通道的选题闸门，
 *      早一年 ⇒ 年度题在真值发布前就被选中结算。
 *   ② 读端口 `p1b/scripts/corpus-resolve-daemon.cjs` 的 `dueOf` **压根没有 year 分支**
 *      ⇒ 年度题一律落 `undatable` ⇒ daemon 永不选中 ⇒ **明明有 resolver 也永不结算，且无告警**。
 *   两端都背离冻结契约 `g2-contract-frozen-r4.json` 的 year/yearly 四 kind：
 *   「date = 次年 12 月 31 日；输入 YYYY」⇒ 应为 `2028-12-31`。**契约是权威。**
 *
 * 为什么测试去读契约、而不是把 2028 写死在断言里：
 *   契约文件是唯一权威且被 `p1b/test/kind-table.test.cjs` 用 sha256 锁住（改契约必先打红那条），
 *   而两端都是**手写件**。按"手写件对齐冻结件"的次序建断言——哪天口径再被拍板一次，
 *   改契约那一步会先让本件在"规则串对不上"处变红，而不是等到数据已经写歪了才发现。
 *
 * ★**⑤ 是本件的核心**：写端口与读端口是两份互不引用的手写件，历史上已分叉（写有 year、读无 year）。
 *   各修一次只能救当下；把「同一输入必须给同一个日期」钉死，下一次谁动其中一边都会当场看见。
 *
 * ★**射程**：只锁 year 这一组。period / month / end / week_start 四组**两端与契约都还不一致**，
 *   不在本件射程——它们的口径须先与 `p1b/src/evidence/dueBranches.js` 的登记表拍板
 *   （end/daily 组契约 prose 与 npm 兄弟现走 end+1d 至今未裁定），先改容易改错。
 *
 * 纯函数直测：require 本件不起端口、不开库（p1a db 惰性连接，getConnection 才 init）；
 *   require 守护进程安全——它有 `require.main === module` 守卫（daemon:538），不触发 main() 写盘打网。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { deriveMaturesAt } = require('../src/db/predictionsStore');
// 守护进程读端口：它有 `require.main === module` 守卫（daemon:538），require 纯函数不触发 main() 的写盘/打网。
const { dueOf } = require('../scripts/corpus-resolve-daemon.cjs');

/** 冻结契约（只读；与 dueBranches.js 同一份，永不写）。 */
const CONTRACT_PATH = path.join(__dirname, '..', 'sim', 'out', 'g2-contract-frozen-r4.json');
const DATE_DERIVATIONS = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')).date_derivations || {};
/** 契约里 year/yearly 这一组的规则原文（照抄契约，变了这里就该变红）。 */
const YEAR_RULE = 'date = 次年 12 月 31 日；输入 YYYY';

test('① 年度题到期日＝次年 12 月 31 日（输入 2027 ⇒ 2028-12-31）', () => {
  assert.equal(
    deriveMaturesAt({ year: 2027 }, []),
    '2028-12-31',
    'year=2027 的到期日必须是次年 12-31（契约 year/yearly），不是 2027-12-31'
  );
});

test('② 契约 year/yearly 四 kind 全口径一致（读契约，不信手写件）', () => {
  const kinds = Object.keys(DATE_DERIVATIONS)
    .filter((k) => DATE_DERIVATIONS[k].source_key === 'year' && DATE_DERIVATIONS[k].granularity === 'yearly')
    .sort();
  assert.ok(kinds.length > 0, '契约里应存在 year/yearly 组（本断言失效说明契约被换过）');
  for (const k of kinds) {
    assert.equal(DATE_DERIVATIONS[k].rule, YEAR_RULE, `${k} 的契约规则被改过，本件须同步复核`);
    // 数字与字符串两种 year 形态都要落次年：写端口的判据是 String(r.year).length===4，两种都命中同一分支。
    assert.equal(deriveMaturesAt({ kind: k, year: 2027 }, []), '2028-12-31', `${k}（数字 year）须落次年`);
    assert.equal(deriveMaturesAt({ kind: k, year: '2027' }, []), '2028-12-31', `${k}（字符串 year）须落次年`);
    assert.equal(deriveMaturesAt({ kind: k, year: 2026 }, []), '2027-12-31', `${k}（另一个年）须同样 +1 年`);
  }
});

test('③ 修 year 不得外扩：非四位年仍推导不出（抛错，不猜）', () => {
  // 口径收紧若顺手放宽了匹配面，会把 year:999 这类脏值编成一个到期日 ⇒ 静默落池，比早一年更难查。
  for (const bad of [{ year: 999 }, { year: 20275 }, { year: '20x7' }]) {
    assert.throws(() => deriveMaturesAt(bad, []), /无法推导到期日/, '非四位年必须抛错：' + JSON.stringify(bad));
  }
});

/** 契约 year/yearly 的四个 kind（与 ② 同源，避免两处各抄一份 kind 名）。 */
function yearKinds() {
  return Object.keys(DATE_DERIVATIONS)
    .filter((k) => DATE_DERIVATIONS[k].source_key === 'year' && DATE_DERIVATIONS[k].granularity === 'yearly')
    .sort();
}

test('④ 守护进程读端口同样认 year（修前落 undatable ⇒ daemon 永不选中）', () => {
  for (const k of yearKinds()) {
    const d = dueOf({ resolve: { kind: k, year: '2027' } });
    assert.notEqual(d.src, 'undatable', `${k} 的 year 分支缺失 ⇒ 落 undatable ⇒ daemon 永不结算`);
    assert.equal(d.due, '2028-12-31', `${k}：读端口到期日须＝次年 12-31（契约 year/yearly）`);
  }
});

test('⑤ ★写读同源：dueOf 与 deriveMaturesAt 对同一输入必须给同一个日期（防两边再次分叉）', () => {
  // 这条是本件存在的核心理由：写端口与读端口是**两份手写件**，历史上已分叉过（写 year、读无 year）。
  // 各断言各修一次只能救当下；把「同输入同日期」钉死，下一次谁改动其中一边都会当场看见。
  for (const k of yearKinds()) {
    for (const y of ['2027', '2026', '2030']) {
      const input = { kind: k, year: y };
      const read = dueOf({ resolve: input });
      const write = deriveMaturesAt(input, []);
      assert.equal(read.due, write,
        `${k}(year=${y}) 写读分叉：写端口 ${write} ≠ 读端口 ${read.due}（契约两者都该是次年 12-31）`);
    }
  }
});
