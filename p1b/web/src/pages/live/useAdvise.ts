/** useAdvise —— 天结算任务 hook（B6 自 AdvisorPage 抽出）：提交→3s 轮询→就绪存档→历史卡。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../api';
import type { AdvisorCard, ServerCard } from '../../types';
import {
  clearRunningTask, loadRunningTask, putArchive, saveRunningTask,
  type ArchiveEntry, type CurrentView, type RunningTask,
} from '../../lib/adviseArchive';

const POLL_MS = 3000;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 轮询返回（TaskStatus + 服务端附加字段，见 p1b/src/routes/advise.js GET /tasks 形状） */
export interface PollBody {
  status: 'running' | 'done' | 'failed';
  card?: (AdvisorCard & { saved?: boolean }) | null;
  error?: string | null;
  game_id?: number;
  day?: number;
  created_at?: string | null;
  finished_at?: string | null;
}

export function useAdvise(opts: { onDone?: (day: number) => void; onFailed?: (msg: string) => void } = {}) {
  const [task, setTask] = useState<RunningTask | null>(null);
  const [taskStatus, setTaskStatus] = useState<PollBody | null>(null);
  const [current, setCurrent] = useState<CurrentView | null>(null);
  const [now, setNow] = useState(Date.now());
  const [serverCards, setServerCards] = useState<ServerCard[] | null>(null);
  const [cardsSource, setCardsSource] = useState<'server' | 'local'>('server');
  const [cardsErr, setCardsErr] = useState<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** 切局认领：在跑任务按局认领 + 服务端卡存档重取（失败降级本机缓存并记因） */
  const adoptGame = useCallback(async (gid: number) => {
    setTask((cur) => {
      if (cur) return cur;
      const t = loadRunningTask();
      return t && t.gameId === gid ? t : null;
    });
    setCurrent(null);
    setTaskStatus(null);
    try {
      const r = await api.listServerCards(gid);
      setServerCards(r.cards);
      setCardsSource('server');
      setCardsErr(null);
    } catch (e) {
      setServerCards(null);
      setCardsSource('local');
      setCardsErr(errMsg(e));
    }
  }, []);

  // 天结算轮询：done → 本机镜像存档 + 就绪回调 + 服务端存档列表刷新；failed → 报错回调
  useEffect(() => {
    if (!task) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const st = (await api.getTask(task.id)) as unknown as PollBody;
        if (stopped) return;
        setTaskStatus(st);
        if (st.status === 'done' && st.card) {
          const entry: ArchiveEntry = { card: st.card, finished_at: st.finished_at ?? null, task_id: task.id };
          putArchive(task.gameId, task.day, entry);
          setCurrent({ source: 'task', gameId: task.gameId, day: task.day, entry });
          clearRunningTask();
          setTask(null);
          optsRef.current.onDone?.(task.day);
          api.listServerCards(task.gameId).then((r) => {
            if (!stopped) { setServerCards(r.cards); setCardsSource('server'); setCardsErr(null); }
          }).catch(() => { /* 保留旧列表 */ });
        } else if (st.status === 'failed') {
          clearRunningTask();
          setTask(null);
          optsRef.current.onFailed?.('参谋卡生成失败：' + (st.error ?? '未知错误'));
        }
      } catch (e) {
        // 单次网络抖动 → 下一轮继续；404（任务不存在，如服务重启）→ 清除陈旧任务并如实报告
        //（G1 反馈#2 修复：此前 404 被静默吞掉，strip 永远卡「生成中 Ns」）
        if (!stopped && e instanceof api.ApiError && e.status === 404) {
          clearRunningTask();
          setTask(null);
          optsRef.current.onFailed?.('参谋卡任务已不存在（服务可能重启过），已停止等待——可重新天结算');
        }
      }
    }, POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [task]);

  // 生成中计时显示
  useEffect(() => {
    if (!task) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [task]);
  const elapsedSec = task ? Math.max(0, Math.round((now - task.startedAt) / 1000)) : 0;

  /** 提交天结算（错误由调用方 catch 展示；空局等预检 400 服务端文案直透） */
  async function startAdvise(gameId: number, day: number) {
    const r = await api.startAdvise(gameId, day);
    const t: RunningTask = { id: r.task_id, gameId, day, startedAt: Date.now() };
    saveRunningTask(t);
    setTask(t);
    setTaskStatus(null);
    setCurrent(null);
  }

  /** 打开服务端某天存档卡（「截至该天」语义；验证点不入库 → 空数组）。
   * G1 反馈#2 修复：失败不再静默（404/网络错此前被 void 丢弃=「点了没反应」）——
   * 置 cardsErr 由 AdvisorZone 展示，保留当前视图不闪空。 */
  async function openServerCard(gameId: number, d: number) {
    setCardsErr(null);
    try {
      const c = await api.getServerCard(gameId, d);
      setCurrent({
        source: 'server',
        gameId,
        day: d,
        entry: { card: { ...c, checkpoints: [], warnings: [] }, finished_at: null, task_id: undefined },
      });
    } catch (e) {
      setCardsErr('第 ' + d + ' 天存档打开失败：' + errMsg(e));
    }
  }

  /** 本机兜底缓存卡（服务端不可达时） */
  function openLocalCard(gameId: number, d: number, entry: ArchiveEntry) {
    setCurrent({ source: 'local', gameId, day: d, entry });
  }

  return { task, taskStatus, current, setCurrent, serverCards, cardsSource, cardsErr, elapsedSec, adoptGame, startAdvise, openServerCard, openLocalCard };
}
