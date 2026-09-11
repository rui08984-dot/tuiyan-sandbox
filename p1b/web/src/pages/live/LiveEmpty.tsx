/** LiveEmpty —— 现场页空态 + 开新局主 CTA（B6 引导流入口）。 */
export default function LiveEmpty(props: { onCreate: () => void }) {
  return (
    <div className="live-hero" data-testid="live-empty">
      <div className="callout" style={{ textAlign: 'left' }}>
        <p className="callout-title">还没有对局</p>
        <p>三步开一局：局名/类型/人数 → 席位名单 → 直达现场开录。</p>
      </div>
      <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={props.onCreate}>
        ＋ 开新局
      </button>
    </div>
  );
}
