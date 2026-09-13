# 步 3 收尾 · emoji 码点级甄别清单（2026-09-13）

方法：emoji_scan.mjs 全量扫描 p1b/web/src/**（正则覆盖 U+2000-2BFF、U+2E00-32FF、U+FE0F、U+1F000-1FAFF、U+1F1E6-1F1FF），逐字符给出码点+行号+上下文；另以 playwright 渲染态实测 16 视口 innerText。

## 结论：真 emoji（U+1F300+ 表情/色块）= 0，VS16（U+FE0F）= 0 → 零改动

三页（IntakePage/ManagePage/SettingsPage）+ LivePage + 12 组件 + TopBar 全部命中。前任粗扫描
IntakePage=20／ManagePage=3／SettingsPage=4 系正则 [\u2190-\u2BFF] 偏宽所致（把下述合法符号计入）。
前任步 2 已将图标全部换成内联 SVG（components/ui/index.tsx:4 注释自证："图标=内联 SVG（Lucide 路径），
emoji 图标清零"），TopBar 天结算钮即 <IconBolt/> SVG。

## 保留符号明细（全部合法，保留理由）

| 符号 | 码点 | 类别 | 出现处（代表行） | 保留理由 |
|---|---|---|---|---|
| → ← | U+2192/U+2190 | 箭头 | Intake 5/29-31/115/157；Manage 62/89；confirm-flow 57；InputBar 20；Timeline 98/111/122 | 流程指向语义（"三问→六层判定"），黑白文本渲染，任务书明示可留 |
| ① ② ③ ④ | U+2460-2463 | 带圈序号 | Intake 121/127/138/145；NewGameWizard 79/80 | 步骤标记，非彩色 emoji |
| ≥ ≤ ∧ − | U+2265/2264/2227/2212 | 数学符 | Intake 40；types 413；ProviderEditorSheet 76；TopBar 47 | 数学/逻辑语义 |
| ─ ═ | U+2500/U+2550 | 制表线 | 各文件注释分隔；AdvisorCardView 37 横幅 | 装饰线，黑白渲染 |
| • … — – | U+2022/2026/2014/2013 | 标点 | 掩码••••、加载中…、破折号 | 常规标点 |
| 「」。（）、 | U+300C/D/3002/FF08 等 | CJK 标点 | 全文 | 中文标点 |
| ＋ | U+FF0B | 全角加号 | Manage 89「＋ 开新局」 | 按钮文字 |
| sk-… | - | 字面量 | ProviderEditorSheet 163 | API Key 掩码提示 |

## 边界外（不属本棒三页，未动）

- MysticPage.tsx:213/310 ☯（U+262F）——「娱乐参考」横幅/玄学页图标，任务边界"mystic 横幅不动"
- MysticPage.tsx:311 ✕（U+2715）——抽屉关闭钮，非彩色 emoji（无 VS16），同页边界外

## 渲染态复核（16 视口实测）

playwright-core + Edge 153 无头，4 页 × 375/768/1024/1440：innerText 中 U+1F000+ 与 FE0F 计数全 0；
横向溢出（scrollWidth-clientWidth）全 0px。明细见 after-pages-metrics.json。

扫描脚本：_tools/emoji_scan.mjs（可复跑）；截图脚本：_tools/shoot2.mjs。
