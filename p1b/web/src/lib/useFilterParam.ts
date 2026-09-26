/** useFilterParam —— 筛选状态写进 URL（2026-09-27 八轮第四改）
 *
 * 【病象：两套导航在打架 + 切页丢状态】
 *   现状：顶栏 9 项导航之外，每页还有一条 240px 的左侧筛选栏；两套都像"导航"，
 *   互不沟通。更糟的是筛选状态全在 useState 里：
 *     · 切到另一页再切回来 ⇒ 选择全丢，得重选一遍
 *     · 刷新 / 前进后退 ⇒ 选择全丢
 *     · 链接分享不出去 ⇒ "我看到的那个 10/29" 别人打不开
 *   独立侦察把它列为「筛选状态是页内孤岛」。
 *
 * 【本 hook 的取舍】
 *   ★**只承载"底片"（选择集），不承载"视图"（排序/列宽/展开）**——
 *     这是方向兵的原话：侧栏因此从"第二套导航"降级为"视图开关"，两者不再争。
 *   ★用 URL query 而非 localStorage：URL 能分享、能前进后退、跨设备天然一致；
 *     localStorage 做不到分享。代价是 URL 变长，故只存**选择的值**不存视图。
 *
 * 用法：
 *   const [pick, setPick] = useFilterParam('layer');       // 自动映射 ?layer=L1,L3
 *   pick: string[]    setPick(['L1']) / setPick(先值 => …) 亦可
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** 从 query 取一组值（逗号分隔，缺失＝空数组）。 */
export function useFilterParam(key: string): [string[], (next: string[] | ((prev: string[]) => string[])) => void] {
  const [params, setParams] = useSearchParams();

  const value = useMemo(() => {
    const raw = params.get(key);
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [params, key]);

  const setValue = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const cur = (p.get(key) || '').split(',').filter(Boolean);
        const val = typeof next === 'function' ? next(cur) : next;
        if (val && val.length) p.set(key, val.join(','));
        else p.delete(key);            // 空＝删掉，不留 layer= 这种脏 query
        return p;
      },
      { replace: false },             // ★不用 replace：让浏览器后退能真的退回上一个筛选
    );
  }, [key, setParams]);

  return [value, setValue];
}

/** 布尔型筛选（只记开/关，如「只看样本够的」）。 */
export function useFlagParam(key: string, dflt = false): [boolean, (v: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw === null ? dflt : raw === '1' || raw === 'true';
  const setValue = useCallback((v: boolean) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (v) p.set(key, '1');
        else p.delete(key);
        return p;
      },
      { replace: false },
    );
  }, [key, setParams]);
  return [value, setValue];
}

export default useFilterParam;
