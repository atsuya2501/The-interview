#!/usr/bin/env node
/* =====================================================================
   data 整合チェック（依存なし・Node標準のみ）
   実行: node validate.js
   目的: 手動 node ワンライナーで都度確認していた整合性を恒久化。
         選穴↔経穴の未登録、resolver機序id、branch解決、JSON妥当性などを検査。
   エラーがあれば終了コード1（CI/コミット前フックに組み込み可）。
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data');
const errors = [];
const warns = [];
const err = m => errors.push(m);
const warn = m => warns.push(m);

// 1) 全 JSON のパース妥当性
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const J = {};
for (const f of files) {
  try { J[f] = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
  catch (e) { err(`[JSON] ${f}: パース失敗 — ${e.message}`); }
}

// 2) 証候マスタ ↔ 経穴マスタ
const ap = J['acupoints.json'], bz = J['tcm_bianzheng.json'];
if (!ap) err('acupoints.json が無い');
if (!bz) err('tcm_bianzheng.json が無い');
if (ap && bz) {
  const defined = new Set(Object.keys(ap.points || {}));
  const used = new Set();
  const synIds = new Set();
  const validWeights = new Set(['main', 'aux', 'obvious']);
  const groupNames = new Set((bz.groups || []).map(g => g.group));

  (bz.groups || []).forEach(g => {
    if (!validWeights.has(g.clinical_weight)) err(`[弁証] グループ「${g.group}」の clinical_weight が不正: ${g.clinical_weight}`);
    (g.syndromes || []).forEach(s => {
      if (synIds.has(s.id)) err(`[弁証] 証id重複: ${s.id}`);
      synIds.add(s.id);
      if (!s.distinct) warn(`[弁証] 証「${s.name}」(${s.id}) に相違点(distinct)が無い`);
      (s.points || []).forEach(p => {
        used.add(p);
        if (!defined.has(p)) err(`[弁証] 証「${s.name}」(${s.id}) の選穴「${p}」が acupoints 未登録`);
      });
    });
  });

  // MOS軸 → グループ の対応先が実在するか
  const a2g = bz.mos_axis_to_group || {};
  Object.keys(a2g).forEach(k => {
    if (k === 'note') return;
    if (!groupNames.has(a2g[k])) err(`[弁証] mos_axis_to_group: 軸「${k}」→ グループ「${a2g[k]}」が存在しない`);
  });

  // 定義済みだが未使用の経穴は警告（西洋治療側からの参照は将来）
  [...defined].filter(p => !used.has(p)).forEach(p => warn(`[経穴] どの証からも参照されていない: ${p}`));
}

// 3) MOSスコア表: axes_order と formulas の整合
const ms = J['mos_scoring.json'];
if (ms) {
  const order = (ms.profile_output && ms.profile_output.axes_order) || [];
  order.forEach(a => { if (!ms.formulas || !ms.formulas[a]) err(`[MOS] axes_order の「${a}」に formulas 定義が無い`); });
}

// 4) 治療マスタ ↔ resolver(track_to_mechanism) の機序id
const tm = J['treatment_master.json'], t2m = J['track_to_mechanism.json'];
if (tm && t2m) {
  const txIds = new Set((((tm[0] || {}).treatments) || []).map(t => t.id));
  (t2m.mappings || []).forEach(m => {
    [...(m.primary || []), ...(m.secondary || [])].forEach(id => {
      if (!txIds.has(id)) err(`[resolver] track「${m.track}」の機序id「${id}」が treatment_master に無い`);
    });
  });
  if (t2m.ia_ib_resolution && !txIds.has('ia_ib_inhibition')) warn('[resolver] ia_ib_inhibition が treatment_master に無い');
}

// 5) 部位疾患マスタ: branch 参照が解決するか／疾患id重複
const regions = ['neck', 'head', 'lumbar', 'face', 'shoulder', 'elbow', 'hand', 'chest', 'abdomen', 'thigh', 'knee', 'lower_leg', 'foot', 'systemic'];
regions.forEach(r => {
  const f = `${r}_diseases.json`;
  const raw = J[f];
  if (!raw) { err(`[部位] ${f} が無い`); return; }
  const root = Array.isArray(raw) ? raw[0] : raw; // 首は配列ラップ
  const valid = new Set();
  if (Array.isArray(root.branches)) root.branches.forEach(b => { valid.add(b.id); valid.add(b.name); });
  else Object.keys(root.branches || {}).forEach(n => valid.add(n));
  const dids = new Set();
  (root.diseases || []).forEach(d => {
    if (dids.has(d.id)) err(`[部位] ${f}: 疾患id重複 ${d.id}`);
    dids.add(d.id);
    const bs = Array.isArray(d.branch) ? d.branch : [d.branch];
    bs.forEach(b => { if (b != null && !valid.has(b)) err(`[部位] ${f}: 疾患「${d.id}」の branch「${b}」が branches 未定義`); });
  });
});

// 出力
if (warns.length) {
  console.log(`⚠ 警告 (${warns.length})`);
  warns.forEach(w => console.log('  ' + w));
}
if (errors.length) {
  console.error(`\n✖ エラー (${errors.length})`);
  errors.forEach(e => console.error('  ' + e));
  process.exitCode = 1;
} else {
  console.log(`\n✓ data 整合チェック OK（${files.length}ファイル・エラーなし${warns.length ? '・警告' + warns.length : ''}）`);
}
