/* =====================================================================
   app-engine.js（後半）: Step④ Rank集計 / Step⑤ 高位診断 / Step⑥ 治療・resolver / 起動
   前半 app.js のグローバル(state, REGIONS, DISEASES 等)を利用。app.js の後に読み込むこと。
   ===================================================================== */
// =====================================================================
// ④ 徒手検査 confirm/exclude を Rank 集計
// =====================================================================

// 1つの所見の寄与：
//   方向 … LRがあればLR優先（≥1で陽性方向）、LRが無ければ種別で決定（confirm=+ / exclude=−）
//   大きさ … Rank重み
function signContribution(finding, kind) {
  let dir;
  if (finding.lr != null) dir = finding.lr >= 1 ? 1 : -1;
  else dir = kind === 'exclude' ? -1 : 1;
  return dir * (RANK_WEIGHT[finding.rank] || 1);
}

// 候補疾患から問診すべき所見リストを構築
function buildFindingItems() {
  const items = [];
  for (const id of state.candidates) {
    const d = diseaseById(id);
    if (!d) continue;
    if (d.findings) {
      (d.findings.confirm || []).forEach((f, i) =>
        items.push({ key: `${id}|c|${i}`, disease: id, kind: 'confirm', ...f }));
      (d.findings.exclude || []).forEach((f, i) =>
        items.push({ key: `${id}|e|${i}`, disease: id, kind: 'exclude', ...f }));
    }
    if (d.tests) {
      d.tests.forEach((t, i) =>
        items.push({ key: `${id}|t|${i}`, disease: id, kind: 'test', sign: t, lr: null, rank: 3 }));
    }
  }
  return items;
}

function renderFindings() {
  const items = buildFindingItems();

  if (items.length === 0) {
    // 問診すべき所見が無い → 集計だけして次へ
    return proceedAfterScoring();
  }

  // 疾患ごとにグルーピング表示
  const groups = {};
  items.forEach(it => { (groups[it.disease] = groups[it.disease] || []).push(it); });

  const groupHtml = Object.keys(groups).map(id => {
    const d = diseaseById(id);
    const rows = groups[id].map(it => {
      const ans = state.findingAnswers[it.key];
      const lrTxt = it.lr != null ? `LR ${it.lr}` : '所見';
      const sub = it.kind === 'confirm' ? 'confirm' : it.kind === 'exclude' ? 'exclude' : 'test';
      const method = findTestMethod(it.sign);
      const infoBtn = method
        ? `<button class="info-btn" data-method="${it.key}" title="実施方法を表示" aria-label="実施方法">ⓘ</button>`
        : '';
      const methodRow = method
        ? `<div class="method" id="m-${it.key}" hidden><b>${method.name}</b>：${method.how}</div>`
        : '';
      return `
        <div class="finding">
          <div class="finding-info">
            <span class="finding-sign">${it.sign}${infoBtn}</span>
            <span class="finding-meta">${sub} ・ ${lrTxt} ・ R${it.rank}</span>
            ${methodRow}
          </div>
          <div class="triple">
            <button class="tri ${ans === 'pos' ? 'on pos' : ''}" data-k="${it.key}" data-v="pos">陽性</button>
            <button class="tri ${ans === 'neg' ? 'on neg' : ''}" data-k="${it.key}" data-v="neg">陰性</button>
          </div>
        </div>`;
    }).join('');
    return `<div class="finding-group"><h3>${d.name}</h3>${rows}</div>`;
  }).join('');

  app().innerHTML = `
    <section class="card">
      ${stepHeader(4, '徒手検査・所見の入力')}
      <p class="lead">各所見を「陽性／陰性」で。未入力は集計に含めません（confirm/exclude を Rank 集計）。</p>
      ${groupHtml}
      <div class="actions">
        <button class="btn primary" id="next4">集計して次へ →</button>
      </div>
    </section>`;

  app().querySelectorAll('.tri').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.k, v = btn.dataset.v;
      const newVal = state.findingAnswers[k] === v ? undefined : v;
      state.findingAnswers[k] = newVal;
      // 全再描画せず、同じ所見の pos/neg ボタンの見た目だけ更新
      // （実施方法トグルの開閉状態・スクロール位置を維持＝臨床で連打する画面の体感改善）
      app().querySelectorAll(`.tri[data-k="${k}"]`).forEach(b => {
        const on = b.dataset.v === newVal;
        b.classList.toggle('on', on);
        b.classList.toggle('pos', on && b.dataset.v === 'pos');
        b.classList.toggle('neg', on && b.dataset.v === 'neg');
      });
    });
  });

  // 実施方法の開閉（再描画せずトグル）
  app().querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = document.getElementById('m-' + btn.dataset.method);
      if (row) { row.hidden = !row.hidden; btn.classList.toggle('open', !row.hidden); }
    });
  });

  document.getElementById('next4').addEventListener('click', proceedAfterScoring);
}

// 疾患の実効 severity を返す。
//   severity（固定）があればそれ。
//   severity_conditional があれば、急性フラグ（陽性所見に「急性」「激痛」を含む）で 急性期/慢性期 を切替。
function effectiveSeverity(s) {
  const d = s.disease;
  if (d.severity_conditional) {
    // 急性期マーカーはデータ側 acute_markers を優先（将来疾患でも判定が漏れないように）。
    const markers = (d.acute_markers && d.acute_markers.length) ? d.acute_markers : ['急性', '激痛'];
    const acute = (s.hits || []).some(h => h.ans === 'pos' && markers.some(m => h.sign.includes(m)));
    return acute ? d.severity_conditional['急性期'] : d.severity_conditional['慢性期'];
  }
  // 経過観察トラック：レッドフラッグ所見が指定数以上揃えば格上げ
  if (d._track === '経過観察') {
    return redflagsMet(s) ? (d.redflag_escalation && d.redflag_escalation.escalate_to || '要注意') : '経過観察';
  }
  return d._severity;
}

// 経過観察トラックの redflag_escalation 条件を満たすか（陽性所見とレッドフラッグ群の一致数で判定）
function redflagsMet(s) {
  const esc = s.disease.redflag_escalation;
  if (!esc) return false;
  const posSigns = (s.hits || []).filter(h => h.ans === 'pos').map(h => h.sign);
  let cnt = 0;
  for (const rf of esc.signs) {
    if (posSigns.some(ps => ps.includes(rf) || rf.includes(ps))) cnt++;
  }
  return cnt >= (esc.count || 99);
}

// Step④集計後の遷移：実効severity緊急→🔴遮断 / 要注意・要医療機関(非緊急)→🟡警告 / それ以外→高位 or 結果
function proceedAfterScoring() {
  state.scored = scoreCandidates();

  // findings を持つ疾患は所見で浮いた時(>0)、持たない疾患は候補入り=示唆 とみなす
  const active = s => s.disease.findings ? s.findingScore > 0 : true;
  const isDanger = d => d.prevalence === 'rare_redflag' || d._track === '要医療機関';

  // 🔴🔴 強制オーバーライド：腹膜刺激徴候/血管系レッドフラッグなどが陽性ならどの疾患でも強制遮断
  for (const ov of OVERRIDES) {
    const hit = state.scored.some(s => (s.hits || []).some(h => h.ans === 'pos' && ov.signs.includes(h.sign)));
    if (hit) {
      state.blockReasons = [{ title: ov.title, message: ov.note || '直ちに医療機関へ。' }];
      state.step = 99;
      return renderStep();
    }
  }

  // 🔴 実効severity緊急（急性腹症・馬尾・石灰沈着性腱炎の急性期など）が浮いたら遮断
  const emergent = state.scored.filter(s => active(s) && effectiveSeverity(s) === '緊急');
  if (emergent.length) {
    state.blockReasons = emergent.map(s => ({ title: s.name, message: s.disease.note || '要医療機関での対応が必要です。' }));
    state.step = 99;
    return renderStep();
  }

  // 🟡 要注意（条件付き慢性期含む）または 要医療機関(非緊急) は警告つき通過
  state.severityWarnings = state.scored
    .filter(s => active(s) && effectiveSeverity(s) !== '緊急'
      && (effectiveSeverity(s) === '要注意' || isDanger(s.disease)))
    .map(s => ({ title: s.name, message: s.disease.note || '要医療機関での対応を検討してください。' }));

  state.step = needLevel() ? 5 : 6;
  renderStep();
}

// 候補疾患の示唆スコアを集計（事前確率素点 + 所見寄与）
function scoreCandidates() {
  const items = buildFindingItems();
  const byDisease = {};
  items.forEach(it => { (byDisease[it.disease] = byDisease[it.disease] || []).push(it); });

  return state.candidates.map(id => {
    const d = diseaseById(id);
    const base = PREVALENCE_BASE[d.prevalence] ?? 0;
    let findingScore = 0;
    const hits = [];
    (byDisease[id] || []).forEach(it => {
      const ans = state.findingAnswers[it.key];
      if (!ans) return;
      let contrib = 0;
      if (it.kind === 'confirm' || it.kind === 'exclude') {
        // 陽性=その所見あり / 陰性=所見の否定（寄与を反転）
        contrib = signContribution(it, it.kind) * (ans === 'pos' ? 1 : -1);
      } else { // test
        contrib = (ans === 'pos' ? 1 : 0) * (RANK_WEIGHT[it.rank] || 1);
      }
      if (contrib !== 0) hits.push({ sign: it.sign, contrib, ans });
      findingScore += contrib;
    });
    return { id, name: d.name, base, findingScore, total: base + findingScore, hits, disease: d };
  }).sort((a, b) => b.total - a.total);
}

// 高位診断の対象疾患：level_localization を持ち、所見で浮いた最上位疾患（部位非依存）
function levelDisease() {
  const ld = state.scored.find(s => s.disease.level_localization);
  return ld || null;
}

// 高位診断が必要か（神経根症などが浮いたか）
function needLevel() {
  const ld = levelDisease();
  if (!ld) return false;
  // 所見で陽性方向に振れている、かつ最上位に来ている
  return ld.findingScore > 0 && ld === state.scored[0];
}

// =====================================================================
// ⑤ 高位診断（C5〜Th1）= 得点降順エンジン
// =====================================================================
function renderLevel() {
  const ld = levelDisease();
  const loc = ld.disease.level_localization;
  const levels = Object.keys(loc);

  const groupHtml = levels.map(lv => {
    const rows = loc[lv].map((sign, i) => {
      const key = `${lv}|${i}`;
      const on = !!state.levelAnswers[key];
      return `
        <label class="check thin">
          <input type="checkbox" data-lv="${key}" ${on ? 'checked' : ''}>
          <span class="check-label">${sign}</span>
        </label>`;
    }).join('');
    return `<div class="finding-group"><h3>${lv}</h3>${rows}</div>`;
  }).join('');

  app().innerHTML = `
    <section class="card">
      ${stepHeader(5, `高位診断（${ld.name}）`)}
      <p class="lead">神経根症が上位に来ています。当てはまる所見をチェック → 得点降順で高位を推定します。</p>
      ${groupHtml}
      <div class="actions">
        <button class="btn primary" id="next5">高位を判定 →</button>
      </div>
    </section>`;

  app().querySelectorAll('[data-lv]').forEach(cb => {
    cb.addEventListener('change', e => {
      state.levelAnswers[e.target.dataset.lv] = e.target.checked;
    });
  });

  document.getElementById('next5').addEventListener('click', () => {
    state.step = 6;
    renderStep();
  });
}

// 高位ごとの得点（マッチした所見数の重み合計）を降順で返す
function scoreLevels() {
  const ld = levelDisease();
  const loc = ld.disease.level_localization;
  return Object.keys(loc).map(lv => {
    let score = 0;
    const matched = [];
    loc[lv].forEach((sign, i) => {
      if (state.levelAnswers[`${lv}|${i}`]) { score += 1; matched.push(sign); }
    });
    return { level: lv, score, matched, total: loc[lv].length };
  }).sort((a, b) => b.score - a.score);
}

// =====================================================================
// ⑥ treatment_track → 治療マスタ
// =====================================================================
function treatmentsForTrack(track) {
  const rule = TRACK_MAP[track];
  if (!rule) return [];
  return TREATMENTS.filter(rule);
}

// treatment_resolver：疾患の treatment_track（元の記述的トラック）から
// track_to_mechanism で機序id群を解決し、TREATMENTS オブジェクトに変換する。
// ・primary→secondary の順、id重複排除
// ・ia_ib_conditional は region が上肢系/下肢系の時のみ ia_ib_inhibition を追加
// 既存12部位の正準トラック（局所筋骨格 等）はマッピングに無いため null を返し従来表示にフォールバック。
function resolveMechanisms(d) {
  if (!TRACK_MECH || !Array.isArray(TRACK_MECH.mappings)) return null;
  const m = TRACK_MECH.mappings.find(x => x.track === d.treatment_track);
  if (!m || m.treat === false || m.treat === 'redirect') return null;

  const ids = [...(m.primary || [])];
  const sec = [...(m.secondary || [])];
  if (m.ia_ib_conditional) {
    const regions = (TRACK_MECH.ia_ib_resolution && TRACK_MECH.ia_ib_resolution.applies_to_regions) || [];
    if (regions.includes(state.region)) sec.push('ia_ib_inhibition');
  }
  const primarySet = new Set(m.primary || []);
  const seen = new Set();
  const txs = ids.concat(sec)
    .filter(id => !seen.has(id) && seen.add(id))
    .map(id => TREATMENTS.find(t => t.id === id))
    .filter(Boolean);
  return { txs, primarySet, reason: m.reason, phaseNote: m.phase_note, conditional: m.treat === 'conditional', redirect: m.redirect_to };
}

// 機序id → 鍼通電パラメータ（周波数・刺激量・時間）文字列。下行性は痛みタイプで周波数を選択。
function esParamsText(id) {
  if (!ELECTRO || !ELECTRO.mechanism_params) return '';
  const ps = ELECTRO.mechanism_params.filter(p => p.mechanism_id === id);
  if (!ps.length) return '';
  return ps.map(p => {
    if (p.frequency_variants) {
      // 結果画面はμ（βエンドルフィン）デフォルト固定。痛みタイプ連動の周波数選択は
      // カルテ側 karte.js の pickDescVariant が step5（情動/天候）から行う。
      const variant = p.frequency_variants[0];
      return `${variant.frequency_hz}・${p.intensity}・${variant.time_min}分（${variant.opioid || ''}/${variant.receptor || ''}）`;
    }
    return `${p.frequency_hz}・${p.intensity}・${p.time_min}分${p.site ? '（' + p.site + '）' : ''}`;
  }).join(' ／ ');
}

// 確定疾患(1位)の患者向け説明HTML（phase進行型/慢性管理型）
function patientScriptHtml(diseaseId) {
  if (!PATIENT_SCRIPTS || !diseaseId) return '';
  const ph = (PATIENT_SCRIPTS.phase_progression_scripts || []).find(s => s.disease_id === diseaseId);
  const ch = (PATIENT_SCRIPTS.chronic_management_scripts || []).find(s => s.disease_id === diseaseId);
  if (ph) {
    const first = ph.phases.slice().sort((a, b) => a.order - b.order)[0];
    return `<div class="card"><h2>患者向け説明（${ph.disease_name}）</h2>
      <p class="hint">経過：${ph.overall_duration}。下は炎症期の例（カルテで病期を切替可）。</p>
      <div class="obs-block"><p>${first ? first.script : ''}</p></div>
      <p class="hint">${ph.treatment_role}</p></div>`;
  }
  if (ch) {
    return `<div class="card"><h2>患者向け説明（${ch.disease_name}）</h2>
      <div class="obs-block"><p>${ch.script}</p></div>
      ${ch.referral_note ? `<p class="hint">⚠ ${ch.referral_note}</p>` : ''}</div>`;
  }
  return '';
}

function renderTreatment() {
  state.step = 99; // 結果画面（プログレス満タン）
  renderProgress();

  // 表示する示唆：スコア降順。要医療機関・レッドフラッグはスコアに関わらず常に表示。
  const isDanger = d => d.prevalence === 'rare_redflag' || d._track === '要医療機関';
  const suggestions = state.scored.filter(s => s.total > 0 || isDanger(s.disease));

  // カルテへ engine_output を保存（カルテ画面が読み込んで自動流し込み）
  try {
    const top = suggestions[0];
    localStorage.setItem('karte_engine_output', JSON.stringify({
      region: (REGIONS[state.region] && REGIONS[state.region].label) || state.region,
      region_key: state.region,
      branch: state.branch,
      confirmed_disease: top ? top.name : null,
      confirmed_disease_id: top ? top.id : null,
      positive_findings: (() => {
        const map = {}; buildFindingItems().forEach(it => { map[it.key] = it.sign; });
        return Object.keys(state.findingAnswers)
          .filter(k => state.findingAnswers[k] === 'pos').map(k => map[k]).filter(Boolean);
      })(),
      findings_detail: (() => {
        const map = {}; buildFindingItems().forEach(it => { map[it.key] = it.sign; });
        return Object.keys(state.findingAnswers)
          .filter(k => state.findingAnswers[k])
          .map(k => ({ sign: map[k], ans: state.findingAnswers[k] }))
          .filter(x => x.sign);
      })(),
      differential_candidates: suggestions.slice(1).map(s => s.name),
      treatment_track: top ? top.disease.treatment_track : null,
      cause_tissue: null,
      saved_at: new Date().toLocaleString('ja-JP')
    }));
  } catch (e) { /* localStorage不可でも鑑別表示は継続 */ }

  // Step⑤の高位
  let levelHtml = '';
  if (needLevel() && Object.keys(state.levelAnswers).some(k => state.levelAnswers[k])) {
    const levels = scoreLevels().filter(l => l.score > 0);
    if (levels.length) {
      levelHtml = `
        <div class="card">
          <h2>高位診断（得点降順）</h2>
          ${levels.map((l, i) => `
            <div class="level-row ${i === 0 ? 'lead-level' : ''}">
              <span class="level-name">${l.level}</span>
              <div class="bar"><div class="bar-fill" style="width:${(l.score / l.total) * 100}%"></div></div>
              <span class="level-score">${l.score}/${l.total}</span>
            </div>
            <div class="level-signs">${l.matched.join(' / ')}</div>
            ${dermatomeDetailLine(l.level) ? `<div class="derm-detail">${dermatomeDetailLine(l.level)}</div>` : ''}`).join('')}
          <p class="hint">最も示唆される高位：<strong>${levels[0].level}</strong></p>
        </div>`;
    }
  }

  // 示唆カード
  const maxTotal = Math.max(...suggestions.map(s => s.total), 1);
  const sugHtml = suggestions.length ? suggestions.map((s, i) => {
    const track = s.disease._track || s.disease.treatment_track;
    const resolved = resolveMechanisms(s.disease);
    const txs = (resolved && resolved.txs.length) ? resolved.txs : treatmentsForTrack(track);
    const isObs = track === '経過観察';
    const isReferral = track === '腰橋渡し';
    const isRed = !isObs && !isReferral && (s.disease.prevalence === 'rare_redflag' || track === '要医療機関');
    const hitTxt = s.hits.length
      ? `<ul class="hit-list">${s.hits.map(h =>
          `<li>${h.sign} <span class="${h.contrib > 0 ? 'plus' : 'minus'}">${h.contrib > 0 ? '+' : ''}${h.contrib}</span></li>`).join('')}</ul>`
      : '<p class="hint">所見入力なし（有病率の事前確率のみ）</p>';

    const obsHtml = (() => {
      const th = s.disease.follow_up_threshold || {};
      const thTxt = [(th.sessions || th.visits) ? (th.sessions || th.visits) + '回' : '', th.weeks ? th.weeks + '週' : ''].filter(Boolean).join(' / ');
      const escalated = redflagsMet(s);
      return `<div class="obs-block">
        <p class="obs-h">📋 経過観察トラック</p>
        <p>鍼治療の適応となりうるが、<b>${thTxt || '一定回数・期間'}</b>で改善しない・悪化する場合は受診勧奨。</p>
        ${escalated ? `<div class="alert yellow"><strong>🟡 レッドフラッグ複数陽性</strong><p>即受診を勧奨してください。</p></div>` : ''}
      </div>`;
    })();

    const dermHtml = s.disease.dermatome_ref && s.disease.dermatome_ref.length
      ? `<div class="derm-block"><div class="derm-h">高位推定（デルマトーム参照）</div>${s.disease.dermatome_ref.map(lv => {
          const p = dermatomeInfo(lv);
          return `<div class="derm-row"><b>${lv}</b> ${p ? p.dermatome : '（マップ未登録）'}</div>`;
        }).join('')}</div>`
      : '';

    const refTarget = (s.disease.referral && s.disease.referral.to)
      || (s.disease.referral_to_head ? '頭部マスタ／専門科' : '腰の鑑別（腰マスタ）');
    const referralHtml = `<div class="obs-block"><p class="obs-h">↩ 他部位・専門科へ橋渡し</p><p>単独確定せず、<b>${refTarget}</b>を参照してください。${s.disease.note ? '<br>' + s.disease.note : ''}</p></div>${dermHtml}`;

    const txHtml = isRed
      ? `<div class="alert red"><strong>要医療機関</strong><p>${TRACK_NOTE['要医療機関']}${s.disease.note ? '<br>' + s.disease.note : ''}</p></div>`
      : isObs
      ? obsHtml
      : isReferral
      ? referralHtml
      : `<div class="tx-block">
           <p class="tx-track">治療方針：<strong>${s.disease.treatment_track}</strong> — ${TRACK_NOTE[s.disease.treatment_track] || TRACK_NOTE[track] || ''}</p>
           ${resolved && resolved.reason ? `<p class="resolver-reason">🧭 ${resolved.reason}</p>` : ''}
           ${txs.map(t => {
             const es = esParamsText(t.id);
             return `
             <div class="tx">
               <div class="tx-head">${(resolved && resolved.primarySet.has(t.id)) ? '<span class="tag primary-tag">第一選択</span> ' : ''}${t.mechanism} <span class="tag">${t.category}</span> <span class="tag light">${t.level}</span></div>
               <div class="tx-body">
                 <div><b>刺激部位</b> ${t.stimulus_site}</div>
                 <div><b>治療点</b> ${t.treatment_location}</div>
                 <div><b>手技</b> ${t.technique}</div>
                 <div><b>神経線維</b> ${t.nerve_fiber.join('・')}</div>
                 ${es ? `<div><b>鍼通電</b> ${es}</div>` : ''}
               </div>
             </div>`; }).join('')}
         </div>`;

    return `
      <div class="card suggestion ${i === 0 ? 'top' : ''} ${isRed ? 'danger' : ''}">
        <div class="sug-head">
          <span class="rank-badge">${i === 0 ? '最も示唆' : '#' + (i + 1)}</span>
          <h2>${s.name}</h2>
          <span class="score-pill">スコア ${s.total}</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${(s.total / maxTotal) * 100}%"></div></div>
        ${s.disease.cardinal_signs ? `<p class="cardinal"><b>主要徴候</b> ${s.disease.cardinal_signs.join(' / ')}</p>` : ''}
        ${s.disease.note && !isRed ? `<p class="note">📝 ${s.disease.note}</p>` : ''}
        ${hitTxt}
        ${txHtml}
        ${(() => {
          const pn = findPeripheralNerve(s.disease.name);
          return pn ? `<div class="derm-block"><div class="derm-h">末梢神経支配（${pn.name}）</div><div class="derm-row">感覚 ${pn.nerve.sensory_area}</div>${pn.nerve.motor ? `<div class="derm-row">運動 ${pn.nerve.motor}</div>` : ''}</div>` : '';
        })()}
        ${(s.disease.composite_rule && s.disease.composite_rule.items) ? `<div class="subtypes"><div class="subtypes-h">複合判定：${s.disease.composite_rule.rule || ''}</div>${s.disease.composite_rule.items.map(it => `<div class="subtype">・${it}</div>`).join('')}</div>` : ''}
        ${s.disease.subtypes ? `<div class="subtypes"><div class="subtypes-h">病型（参考表示）</div>${Object.entries(s.disease.subtypes).map(([k, v]) => `<div class="subtype"><b>${k}</b> ${v}</div>`).join('')}</div>` : ''}
      </div>`;
  }).join('') : `<div class="card"><p class="lead">明確に示唆される疾患はありませんでした。問診・所見を見直してください。</p></div>`;

  const warnHtml = [...state.redWarnings, ...state.severityWarnings].map(f =>
    `<div class="alert yellow"><strong>🟡 ${f.title}</strong><p>${f.message}</p></div>`).join('');

  const topDisease = suggestions[0] && suggestions[0].disease;
  const scriptHtml = topDisease ? patientScriptHtml(topDisease.id) : '';

  app().innerHTML = `
    <section class="result">
      <div class="result-banner">示唆される鑑別（確定診断ではありません）</div>
      ${warnHtml}
      ${levelHtml}
      ${sugHtml}
      ${scriptHtml}
      <div class="actions">
        ${(window.self !== window.top)
          ? '<button class="btn primary" id="diff-continue">問診の続き（Step4）へ →</button>'
          : (localStorage.getItem('intake_return') === '1'
            ? '<a class="btn primary" href="intake.html#step-4">問診へ戻る（Step4へ）→</a>' : '')}
        <button class="btn" id="restart">最初からやり直す</button>
      </div>
    </section>`;
  document.getElementById('restart').addEventListener('click', restart);
  const cont = document.getElementById('diff-continue');
  if (cont) cont.addEventListener('click', () => {
    try { window.parent.postMessage({ type: 'intake-continue' }, '*'); } catch (e) {}
  });
}

function restart() {
  state.step = 0;
  state.region = null;
  state.redAnswers = {};
  state.redWarnings = [];
  state.branch = null;
  state.candidates = [];
  state.movement = null;
  state.findingAnswers = {};
  state.levelAnswers = {};
  state.scored = [];
  state.blockReasons = [];
  state.severityWarnings = [];
  try { localStorage.removeItem('intake_return'); } catch (e) {}
  renderStep();
}

// =====================================================================
// 起動 & Service Worker
// =====================================================================
init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

