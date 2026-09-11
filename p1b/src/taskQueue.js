'use strict';
/**
 * p1b/src/taskQueue.js —— 内存异步任务队列（P1B-SPEC §0 拍板 #4：天结算后台跑，录入不被阻塞）。
 * 状态机：running → done | failed（轮询 GET /api/tasks/:taskId）。
 * 仅存内存（重启即失，规格允许）；容量上限淘汰最旧的已完结任务。
 */
function createTaskQueue({ runner, maxTasks = 200 }) {
  if (typeof runner !== 'function') throw new Error('taskQueue: runner(gameId, day) 必须为函数');
  const tasks = new Map();
  let counter = 0;

  function prune() {
    if (tasks.size <= maxTasks) return;
    for (const [k, t] of tasks) {
      if (t.status === 'done' || t.status === 'failed') {
        tasks.delete(k);
        if (tasks.size <= maxTasks) break;
      }
    }
  }

  function enqueue(gameId, day) {
    const taskId = 'adv-' + Date.now().toString(36) + '-' + (++counter) + '-' + Math.random().toString(36).slice(2, 7);
    const task = {
      task_id: taskId,
      game_id: gameId,
      day,
      status: 'running',
      card: null,
      error: null,
      created_at: new Date().toISOString(),
      finished_at: null,
    };
    tasks.set(taskId, task);
    prune();
    // 微任务异步执行：POST 立即返回 taskId，进度靠轮询
    Promise.resolve()
      .then(() => runner(gameId, day))
      .then((card) => { task.card = card; task.status = 'done'; })
      .catch((e) => { task.status = 'failed'; task.error = (e && e.message) ? e.message : String(e); })
      .finally(() => { task.finished_at = new Date().toISOString(); });
    return task;
  }

  function get(taskId) { return tasks.get(taskId) || null; }
  function size() { return tasks.size; }

  return { enqueue, get, size };
}

module.exports = { createTaskQueue };
