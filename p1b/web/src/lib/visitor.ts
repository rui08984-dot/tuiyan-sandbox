/**
 * 访客标识 —— 「同一个人」的最小可信单位（P0-5 三桶的前提）
 *
 * 【为什么单独抽一个文件】
 *   两个页面都要问「这道题归谁」，而答案只取决于本机这枚标识。
 *   标识只有一份 ⇒ 逻辑也只能有一份：抽出来才不会出现两页各写一遍、各错一遍。
 *
 * 【它是什么 / 不是什么】
 *   是：一枚本机保存的字符串，**只发给自己的后端**（问「我的题」用），绝不上报到别处。
 *   不是：不是账号、不是身份、不是 cookie 里的追踪符。
 *     没有它，界面对「这道题归谁」一律 fail-closed 当「不知道」——
 *     不知道你是谁时把别人的题说成你的，比说「这是别人的」坏得多。
 *
 * 【为什么必须 await，不能在挂载那一刻同步读一次 localStorage】
 *   新浏览器首访时本机**没有**标识，得先向服务端换一枚
 *   （`POST /api/analytics/session/start` 是唯一会发号的端点；`GET /api/analytics/questions`
 *   对不认识的 id 直接 400，所以本地凭空编一个也不行）。
 *   换回来之前任何同步读到的都是 null。
 *   ⇒ 若取数 effect 与发号 effect 都在挂载那一轮跑、而依赖数组里又没有那个 id，
 *     首访就会永远停在「没有访客标识」，得靠用户手动切一下视图才恢复。
 *     这不是理论风险：WhereOffPage 的三桶段就踩着这个形状（`WhereOffPage.tsx:189-200`）。
 *     这里的做法是**把发号做成可 await 的函数**，由取数的那个 effect 自己等它 ——
 *     谁在 mount 跑、依赖怎么写，都不再是正确性的前提。
 *
 * 【不做的事】
 *   本模块**不**管会话起止（P0-4 的 session start/end/pagehide 归 WhereOffPage），
 *   也**不**上报事件。这里只借那个端点**换一枚 id**，不重复开会话、不重复埋点。
 */

/** 访客 id 存在本机：让「同一个人」在多次会话间可被认出；库里没有第二份可关联的字段。 */
export const VISITOR_KEY = 'p1b_visitor_id';
/** 作者密钥（可选）。没设置就不发这个字段——后端会判成访客。 */
export const AUTHOR_KEY = 'p1b_author_key';

function readLocal(k: string): string | undefined {
  try { const v = localStorage.getItem(k); return v ? v : undefined; } catch (e) { return undefined; }
}
function writeLocal(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式下写不进去：取不到就取不到，不报错 */ }
}

/** 本机现有的标识（没有就是 undefined）。**只读**，不发起任何请求。 */
export function readVisitorId(): string | undefined {
  return readLocal(VISITOR_KEY);
}

/**
 * 确保本机有一枚标识，返回它；换不到就返回 null。
 *
 * ★三条纪律：
 *   ① 失败**一律吞掉**并返回 null —— 读数页不许因为标识服务挂了而变错误态。
 *   ② 绝不凭空造 id：本地编一个发出去，后端会 400，白跑一趟还让人以为「我没有题」。
 *   ③ 已有的标识**原样返回**、不重发 —— 同一枚号跨会话稳定，正是「同一个人」的依据。
 *
 * @param fresh 传 true 时跳过缓存直发（诊断用：确认服务端认不认这枚号）。默认 false。
 */
export async function ensureVisitorId(fresh = false): Promise<string | null> {
  const prior = readVisitorId();
  if (prior && !fresh) return prior;
  try {
    const r = await fetch('/api/analytics/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // author_key 带上：本机若配了作者密钥，这一页就该记在作者名下而不是访客名下
      body: JSON.stringify({ visitor_id: prior, author_key: readLocal(AUTHOR_KEY) }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || typeof j.visitor_id !== 'string' || !j.visitor_id) return null;
    writeLocal(VISITOR_KEY, j.visitor_id);
    return j.visitor_id;
  } catch (e) {
    return null;
  }
}
