#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
p1b/scripts/d2-hb.py —— D2-HB 层级贝叶斯部分池化（照 PREREG-D2-HB-v1 逐条兑现）。

判据来源（唯一）：.scratch/forecast-debate/PREREG-D2-HB-v1.md（sha e510a58d…，冻结后禁改）
上游：规格 D2 §11.5（部分池化条款）＋ E-算法工具箱 §8（HB 原理/形态/收敛诊断）。

模型（PREREG §3.2，写死）：
    mu      ~ Normal(0, 1.5)
    tau     ~ HalfNormal(1.0)
    eta_g   ~ Normal(0, 1)          # 非中心化（防漏斗）
    theta_g = sigmoid(mu + tau * eta_g)
    y_i     ~ Bernoulli(theta_{g(i)})   # g = city×month（随机效应，照 §11.5 ②）

采样超参（PREREG §3.4，写死）：4 链 / tune 1000 / draw 2000 / target_accept 0.95 / seed 987654321 / cores 1
收敛判据（PREREG §5，写死）：R̂<1.01 ∧ ESS≥400 ∧ divergences=0 ∧ BFMI≥0.3 —— 任一不达即整体作废

输出（PREREG §4）：每单元（horizon档×难度档）给 收缩后估计 + 收缩量 + 95%等尾区间（＋ n/ybar 披露）

用法：py p1b/scripts/d2-hb.py [--in <d2-report.json>] [--out <d2-hb-report.json>]
零账本写、零 LLM。
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import pymc as pm
import arviz as az

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# ── 冻结物（PREREG §3.2/§3.4/§5；禁改）──
PRIOR_MU_SD = 1.5
PRIOR_TAU_SD = 1.0
CHAINS = 4
TUNE = 1000
DRAWS = 2000
TARGET_ACCEPT = 0.95
SEED = 987654321
CORES = 1
# 收敛判据
R_HAT_MAX = 1.01
ESS_MIN = 400.0
DIVERGENCES_MAX = 0
BFMI_MIN = 0.3
MIN_N = 30


def hbucket(hd):
    return 'short' if hd <= 7 else ('mid' if hd <= 30 else 'long')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', default=os.path.join(ROOT, '.scratch', 'backtest', 'd2-report.json'))
    ap.add_argument('--out', dest='out', default=os.path.join(ROOT, '.scratch', 'backtest', 'd2-hb-report.json'))
    a = ap.parse_args()

    with open(a.inp, 'r', encoding='utf-8') as f:
        rep = json.load(f)
    rows = rep['rows']
    print('== D2-HB 层级贝叶斯部分池化 ==')
    print('  题数 = %d' % len(rows))

    # ── 组键：city × month（随机效应，照 PREREG §3.1）──
    keys = []
    for r in rows:
        keys.append('%s|%s' % (r['city'], r['month']))
    uniq = sorted(set(keys))
    gidx = {k: i for i, k in enumerate(uniq)}
    G = len(uniq)
    gi = np.array([gidx[k] for k in keys], dtype='int64')
    y = np.array([int(r['y']) for r in rows], dtype='int64')
    print('  组数 G = %d（city×month）' % G)

    # ── 模型（PREREG §3.2；非中心化参数化）──
    with pm.Model() as model:
        mu = pm.Normal('mu', mu=0.0, sigma=PRIOR_MU_SD)
        tau = pm.HalfNormal('tau', sigma=PRIOR_TAU_SD)
        eta = pm.Normal('eta', mu=0.0, sigma=1.0, shape=G)
        theta = pm.Deterministic('theta', pm.math.sigmoid(mu + tau * eta))
        pm.Bernoulli('obs', p=theta[gi], observed=y)
        idata = pm.sample(draws=DRAWS, tune=TUNE, chains=CHAINS, cores=CORES,
                          target_accept=TARGET_ACCEPT, random_seed=SEED, progressbar=False)
        # 后验预测检查（供披露；不进判据）
        try:
            pm.sample_posterior_predictive(idata, extend_inferencedata=True, random_seed=SEED, progressbar=False)
        except Exception as e:
            print('  （后验预测检查跳过：%s）' % e)

    # ── 收敛判据（PREREG §5；任一不达即整体作废）──
    print('')
    print('[收敛诊断]（PREREG §5：R̂<%.2f ∧ ESS≥%.0f ∧ div=%d ∧ BFMI≥%.1f）' % (R_HAT_MAX, ESS_MIN, DIVERGENCES_MAX, BFMI_MIN))
    summary = az.summary(idata, var_names=['mu', 'tau', 'theta'], kind='diagnostics')
    rhat_max = float(np.nanmax(summary['r_hat'].values))
    ess_min = float(np.nanmin(np.minimum(summary['ess_bulk'].values, summary['ess_tail'].values)))
    n_div = int(idata.sample_stats['diverging'].values.sum())
    # arviz 1.3.0 的 az.bfmi 返回 DataTree（含 energy 变量）⇒ 取其 energy 再转数组
    _bfmi = az.bfmi(idata)
    try:
        _bfmi_arr = np.asarray(_bfmi['energy'].values, dtype=float)
    except Exception:
        _bfmi_arr = np.asarray(_bfmi.to_array().values, dtype=float).reshape(-1)
    bfmi_min = float(np.nanmin(_bfmi_arr))
    print('  R̂ max      = %.4f  (阈 <%.2f)  %s' % (rhat_max, R_HAT_MAX, 'OK' if rhat_max < R_HAT_MAX else 'FAIL'))
    print('  ESS min    = %.1f  (阈 >=%.0f)  %s' % (ess_min, ESS_MIN, 'OK' if ess_min >= ESS_MIN else 'FAIL'))
    print('  divergences= %d  (阈 =%d)  %s' % (n_div, DIVERGENCES_MAX, 'OK' if n_div <= DIVERGENCES_MAX else 'FAIL'))
    print('  BFMI min   = %.3f  (阈 >=%.1f)  %s' % (bfmi_min, BFMI_MIN, 'OK' if bfmi_min >= BFMI_MIN else 'FAIL'))
    conv_pass = (rhat_max < R_HAT_MAX) and (ess_min >= ESS_MIN) and (n_div <= DIVERGENCES_MAX) and (bfmi_min >= BFMI_MIN)
    print('  ⇒ 收敛判定 = %s' % ('PASS' if conv_pass else '**FAIL ⇒ 本批 HB 输出整体作废**'))

    # ── 单元输出（PREREG §4：收缩后估计 + 收缩量 + 95%等尾区间）──
    theta_post = idata.posterior['theta'].values.reshape(-1, G)   # (chain*draw, G)
    theta_mean = theta_post.mean(axis=0)
    theta_lo = np.percentile(theta_post, 2.5, axis=0)
    theta_hi = np.percentile(theta_post, 97.5, axis=0)
    ybar_global = float(y.mean())

    cells = {}
    for i, r in enumerate(rows):
        ck = '%s|%s' % (hbucket(r['horizon_days']), r['tier'])
        cells.setdefault(ck, []).append(i)

    out_cells = []
    for ck in sorted(cells.keys()):
        idx = cells[ck]
        n = len(idx)
        ybar_unit = float(y[idx].mean())
        # 单元所属组的后验（取该单元内组后验的均值；同单元可能跨组）
        gs = sorted(set(int(gi[i]) for i in idx))
        tmean = float(np.mean([theta_mean[g] for g in gs]))
        tlo = float(np.mean([theta_lo[g] for g in gs]))
        thi = float(np.mean([theta_hi[g] for g in gs]))
        # 收缩量（★ v1.1 勘误 HB-A **修正版**：改用**插值系数**，天然落 [0,1]）
        #   演进：v1 原式 1-|post-unit|/max(eps,|unit-global|) ⇒ 出负值；
        #         v1.1 初稿 1-|post-unit|/max(|post-global|,|unit-global|,eps) ⇒ **仍出负值**
        #         （因 |p-u| 不受 max(|p-g|,|g-u|) 约束，三角不等式只给 |p-g|+|g-u| 的上界）；
        #         最终改用插值系数 lambda=(unit-post)/(unit-global)，clip 到 [0,1]，并披露 raw。
        d_ug = ybar_unit - ybar_global
        lam_raw = ((ybar_unit - tmean) / d_ug) if abs(d_ug) > 1e-9 else 0.0
        shrink = max(0.0, min(1.0, lam_raw))
        out_cells.append({
            'cell': ck, 'n': n, 'ybar_unit': ybar_unit, 'ybar_global': ybar_global,
            'groups': [uniq[g] for g in gs],
            'theta_post_mean': tmean, 'shrinkage': shrink, 'shrinkage_raw': lam_raw, 'hdi95': [tlo, thi],
            'needs_pooling': n < MIN_N,
            'conclusion_allowed': (n >= MIN_N),
        })

    print('')
    print('[单元输出]（PREREG §4：收缩后估计 + 收缩量 + 95% 等尾区间）')
    for c in out_cells:
        tag = '（n<%d ⇒ 只给池化估计）' % MIN_N if c['needs_pooling'] else ''
        print('  %-14s n=%3d  ybar=%.3f → 收缩后=%.3f  收缩量=%.3f  95%%=[%.3f,%.3f] %s'
              % (c['cell'], c['n'], c['ybar_unit'], c['theta_post_mean'], c['shrinkage'], c['hdi95'][0], c['hdi95'][1], tag))

    # ── 组级汇总（v1.1 单调性判据用：组内 n 越少 ⇒ 平均收缩量越大）──
    group_rows = []
    for gi_, gname in enumerate(uniq):
        idx = [i for i in range(len(rows)) if int(gi[i]) == gi_]
        gn = len(idx)
        gy = float(y[idx].mean()) if gn else 0.0
        gm = float(theta_mean[gi_])
        gd = gy - ybar_global
        glam = ((gy - gm) / gd) if abs(gd) > 1e-9 else 0.0
        group_rows.append({"group": gname, "n": gn, "ybar": gy, "post": gm, "lambda_raw": glam, "shrinkage": max(0.0, min(1.0, glam))})
    def _bucket(gn):
        return "n<=5" if gn <= 5 else ("6-10" if gn <= 10 else ">10")
    gsum = {}
    for g in group_rows:
        b = _bucket(g["n"])
        gsum.setdefault(b, []).append(g["shrinkage"])
    group_mono = {b: float(np.mean(v)) for b, v in sorted(gsum.items())}
    mono_ok = True
    keys_b = [b for b in ["n<=5", "6-10", ">10"] if b in group_mono]
    for a_, b_ in zip(keys_b, keys_b[1:]):
        if group_mono[a_] < group_mono[b_]:
            mono_ok = False
    report = {
        'script': 'p1b/scripts/d2-hb.py',
        'prereg': '.scratch/forecast-debate/PREREG-D2-HB-v1.md',
        'prereg_sha256': 'e510a58d556a8421b830a6bd1641191d34e66f1a7c322fad9594d57129f5d1a1',
        'prereg_v11': '.scratch/forecast-debate/PREREG-D2-HB-v1.1-补充与勘误.md',
        'shrinkage_formula': 'v1.1: 1 - |post-unit| / max(|post-global|, |unit-global|, eps)',
        'engine': 'PyMC %s / Python %s' % (pm.__version__, sys.version.split()[0]),
        'frozen': {
            'prior': {'mu': 'Normal(0, 1.5)', 'tau': 'HalfNormal(1.0)', 'eta': 'Normal(0,1)', 'param': 'non-centered'},
            'structure': {'random_effect': 'city x month', 'unit': 'horizon_bucket x tier'},
            'layers': ['L3'],
            'sampling': {'chains': CHAINS, 'tune': TUNE, 'draws': DRAWS, 'target_accept': TARGET_ACCEPT, 'seed': SEED, 'cores': CORES},
            'convergence': {'r_hat_max': R_HAT_MAX, 'ess_min': ESS_MIN, 'divergences_max': DIVERGENCES_MAX, 'bfmi_min': BFMI_MIN},
        },
        'convergence': {'r_hat_max': rhat_max, 'ess_min': ess_min, 'divergences': n_div, 'bfmi_min': bfmi_min, 'pass': bool(conv_pass)},
        'n_questions': len(rows), 'n_groups': G, 'ybar_global': ybar_global,
        'by_cell': out_cells,
        'by_group': group_rows,
        'group_monotonicity': {'by_n_bucket': group_mono, 'monotonic': bool(mono_ok)},
        'honesty': '【回测】HB 池化估计非实测读数；收缩语义＝小样本的谦逊明文（E-工具箱 §8.8）；不得当结论引用',
        'isolation_note': '零账本写（只读 d2-report.json）；零 LLM',
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print('')
    print('产物 = %s' % a.out)
    if not conv_pass:
        sys.exit(3)   # 收敛不达标 ⇒ 非零退出（照 PREREG §5「整体作废」）


if __name__ == '__main__':
    main()
