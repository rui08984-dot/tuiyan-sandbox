'use strict';
const { db } = require('E:/music player/p1b/src/deps');
const { ensurePredictionsTable, insertPrediction } = require('E:/music player/p1b/src/db/predictionsStore');
db.init(':memory:');
const conn = db.getConnection();
conn.exec("CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY, name TEXT, game_type TEXT, player_count INTEGER, created_at TEXT)");
if (!conn.prepare('SELECT COUNT(*) c FROM games').get().c) conn.exec("INSERT INTO games VALUES (1,'t','werewolf_sim_11p_tuicheng',11,datetime('now'))");
ensurePredictionsTable(conn);
function t(label, fn) {
  try { const r = fn(); console.log('NO-THROW | ' + label + ' -> id=' + (r && r.id)); }
  catch (e) { console.log('THROWS   | ' + label + ' | ' + String(e.message).slice(0, 74)); }
}
t('checklist_hash  (snake, F16原形)', () => insertPrediction({ gameId:1, sourceType:'预测卡', statement:'s1', checklist_hash:'v2' }));
t('baseline_brier  (snake)', () => insertPrediction({ gameId:1, sourceType:'预测卡', statement:'s2', baseline_brier:0.2 }));
t('secondary_layer (snake)', () => insertPrediction({ gameId:1, sourceType:'预测卡', statement:'s3', secondary_layer:'L4' }));
t('public_exposure (snake)', () => insertPrediction({ gameId:1, sourceType:'预测卡', statement:'s4', public_exposure:0 }));
t('checklistHash   (camel正确)', () => insertPrediction({ gameId:1, sourceType:'预测卡', statement:'s5', checklistHash:'v2' }));
t('checkListHash   (驼峰笔误)', () => insertPrediction({ gameId:1, sourceType:'预测卡', statement:'s6', checkListHash:'v2' }));
t('checklisthash   (全小写笔误)', () => insertPrediction({ gameId:1, sourceType:'预测卡', statement:'s7', checklisthash:'v2' }));
t('gates           (复数笔误)', () => insertPrediction({ gameId:1, sourceType:'预测卡', statement:'s8', gates:'descriptive' }));
t('baselineBrierX  (后缀笔误)', () => insertPrediction({ gameId:1, sourceType:'预测卡', statement:'s9', baselineBrierX:0.3 }));
console.log('--- 笔误键落库检查（静默丢字段？） ---');
for (const st of ['s6','s7','s8','s9']) {
  console.log(st + ': ' + JSON.stringify(conn.prepare('SELECT checklist_hash, gate, baseline_brier FROM predictions WHERE statement=?').get(st)));
}
db.closeCurrent();
