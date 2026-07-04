/* =====================================================================
   東洋弁証スコア（MOS）エンジン — 独立・自己完結（IIFEでグローバル汚染なし）
   mos_questions.json / mos_scoring.json を読み、51問の加点式で11軸の
   弁証プロファイルを算出・表示。回答は localStorage に保存。
   ※ app.js / karte.js とは別ページ。共有リソースは将来 tcm_findings に接続。
   ===================================================================== */
(function () {
  'use strict';
  const root = () => document.getElementById('mos');
  const ANSWERS_KEY = 'mos_answers';
  const SCALEMODE_KEY = 'mos_scale_mode'; // 'M' | 'F'
  const SCALE = { '常にある': 2, '時々ある': 1, 'ない': 0 };
  let QUESTIONS = null, SCORING = null, BIANZHENG = null, ACUPOINTS = null, TCM_FINDINGS = null;
  let rerankTimer = null; // 相違点チェックの再ランクをデバウンス
  const BZ_SELECTED_KEY = 'mos_selected_syndrome';
  const TONGUE_PULSE_KEY = 'mos_tongue_pulse';

  // 舌脈所見 → 証候の tongue_pulse 文中キーワードの対応（臨床経験ベースの簡易照合。tcm_findings.json の enum を再利用）
  const TP_KEYWORDS = {
    strength: { '弱い': ['弱', '虚脈', '濡弱', '沈弱', '沈細', '濡数'], '強い': ['数', '洪', '滑数', '弦数', '有力', '緊脈'] },
    tongue_color: { '淡白': ['淡'], '紅・紫': ['紅', '紫', '絳'] },
    tongue_shape: { '胖大(ワイド)': ['胖大', '歯痕'], '老(シャープ)': ['老', '痩', '裂'] }
  };
  function getTonguePulse() { try { return JSON.parse(localStorage.getItem(TONGUE_PULSE_KEY) || '{}'); } catch (e) { return {}; } }
  function setTonguePulse(o) { try { localStorage.setItem(TONGUE_PULSE_KEY, JSON.stringify(o)); } catch (e) {} }
  // 選択済み舌脈所見と証の tongue_pulse 記載を照合し、一致数と一致ラベルを返す
  function tonguePulseMatch(s) {
    const tp = getTonguePulse();
    const text = s.tongue_pulse || '';
    let score = 0;
    const matched = [];
    const check = (val, map, label) => {
      if (!val || val === '正常') return;
      const kws = map[val];
      if (kws && kws.some(k => text.includes(k))) { score += 1; matched.push(`${label}:${val}`); }
    };
    check(tp.strength, TP_KEYWORDS.strength, '脈');
    check(tp.tongue_color, TP_KEYWORDS.tongue_color, '舌色');
    check(tp.tongue_shape, TP_KEYWORDS.tongue_shape, '舌形');
    return { score, matched };
  }

  function loadAnswers() { try { return JSON.parse(localStorage.getItem(ANSWERS_KEY) || '{}'); } catch (e) { return {}; } }
  function saveAnswers(a) { try { localStorage.setItem(ANSWERS_KEY, JSON.stringify(a)); } catch (e) {} }
  function getMode() { try { return localStorage.getItem(SCALEMODE_KEY) === 'F' ? 'F' : 'M'; } catch (e) { return 'M'; } }
  function setMode(m) { try { localStorage.setItem(SCALEMODE_KEY, m); } catch (e) {} }

  // section文字 → 所属設問番号配列
  function sectionMap() {
    const m = {};
    QUESTIONS.sections.forEach(s => { m[s.section] = s.questions.map(q => q.no); });
    return m;
  }

  // 弁証スコア算出
  function compute() {
    const ans = loadAnswers();
    const mode = getMode();
    const F = mode === 'F';
    const q = no => Number(ans[no] || 0);
    const secMap = sectionMap();
    const sum = sec => (secMap[sec] || []).reduce((a, no) => a + q(no), 0);

    const L49 = F ? q(49) : 0, L50 = F ? q(50) : 0, L51 = F ? q(51) : 0;
    const raw = {
      '肝': sum('A') + L49 + L50,
      '心': sum('B'),
      '脾': sum('C'),
      '肺': sum('D'),
      '腎': sum('E'),
      '気虚': sum('F') + q(9) + q(20),
      '陽虚': sum('G'),
      '陰虚': sum('H'),
      '血虚': sum('I') + q(3) + q(4) + L50,
      '気滞': sum('J') + q(5),
      '血瘀': sum('K') + L49 + L51
    };
    return { raw, mode, F };
  }

  function renderProfile() {
    const out = document.getElementById('mos-profile');
    if (!out) return;
    const { raw, F } = compute();
    const order = SCORING.profile_output.axes_order;
    const rows = order.map(axis => {
      const max = (SCORING.formulas[axis].axis_max[F ? 'F' : 'M']) || 1;
      const val = Math.min(raw[axis], max);
      const pct = Math.round((val / max) * 100);
      return { axis, val, max, pct };
    });
    const top = rows.slice().sort((a, b) => b.pct - a.pct)[0];
    out.innerHTML = `
      <h2>弁証プロフィール（${F ? 'Fスケール' : 'Mスケール'}）</h2>
      ${rows.map(r => `
        <div class="mos-row ${top && r.axis === top.axis && r.pct > 0 ? 'mos-top' : ''}">
          <span class="mos-axis">${r.axis}</span>
          <div class="bar"><div class="bar-fill" style="width:${r.pct}%"></div></div>
          <span class="mos-score">${r.val}/${r.max}</span>
        </div>`).join('')}
      <p class="hint">${top && top.pct > 0 ? `最も高い軸：<strong>${top.axis}</strong>（主証の示唆）` : '回答を入力してください。'}　確定証ではなく傾向の示唆です。</p>`;
  }

  // =====================================================================
  // 弁証論治（証へ降りる）: MOS高軸 → 証候グループ → 相違点で証確定 → 選穴＋手技
  // =====================================================================
  function getSelected() { try { return localStorage.getItem(BZ_SELECTED_KEY) || ''; } catch (e) { return ''; } }
  function setSelected(id) { try { id ? localStorage.setItem(BZ_SELECTED_KEY, id) : localStorage.removeItem(BZ_SELECTED_KEY); } catch (e) {} }

  // ツボ名 → acupoints 参照（読み・経絡・コード）。未登録なら名前のみ。
  function pointHtml(name) {
    const p = ACUPOINTS && ACUPOINTS.points && ACUPOINTS.points[name];
    if (!p) return `<span class="bz-point">${name}</span>`;
    return `<span class="bz-point" title="${p.reading}・${p.meridian}">${name}<small>${p.code}</small></span>`;
  }

  // 各軸の到達率(%)（renderProfile と同じ算出）
  function axisPcts() {
    const { raw, F } = compute();
    const order = SCORING.profile_output.axes_order;
    const map = {};
    order.forEach(axis => {
      const max = (SCORING.formulas[axis].axis_max[F ? 'F' : 'M']) || 1;
      const val = Math.min(raw[axis], max);
      map[axis] = { val, max, pct: Math.round((val / max) * 100) };
    });
    return map;
  }

  // 立っている軸 → 対応する証候グループを relevance(%)つきで返す（重み main→aux→obvious、同重みは%降順）
  function relevantGroups() {
    if (!BIANZHENG) return [];
    const pcts = axisPcts();
    const a2g = BIANZHENG.mos_axis_to_group || {};
    const info = {}; // group -> {pct, axes:[]}
    Object.keys(pcts).forEach(axis => {
      if (pcts[axis].val <= 0) return;
      const g = a2g[axis];
      if (!g) return;
      if (!info[g]) info[g] = { pct: 0, axes: [] };
      info[g].pct = Math.max(info[g].pct, pcts[axis].pct);
      info[g].axes.push(axis);
    });
    // 気血同病：気系と血系が両方立っていれば複合証として提示（軸→グループ表に無い合流パターン）
    const qiAxes = ['気虚', '陽虚', '気滞'], xueAxes = ['血虚', '血瘀'];
    const qiUp = qiAxes.some(a => pcts[a] && pcts[a].val > 0);
    const xueUp = xueAxes.some(a => pcts[a] && pcts[a].val > 0);
    if (qiUp && xueUp) {
      const qiPct = Math.max(...qiAxes.map(a => pcts[a] ? pcts[a].pct : 0));
      const xuePct = Math.max(...xueAxes.map(a => pcts[a] ? pcts[a].pct : 0));
      info['気血同病'] = { pct: Math.min(qiPct, xuePct), axes: ['気系＋血系'] };
    }
    const weightRank = { main: 0, aux: 1, obvious: 2 };
    return Object.keys(info).map(g => {
      const def = (BIANZHENG.groups || []).find(x => x.group === g) || { group: g, syndromes: [] };
      return Object.assign({}, def, { _pct: info[g].pct, _axes: info[g].axes });
    }).sort((a, b) =>
      (weightRank[a.clinical_weight] - weightRank[b.clinical_weight]) || (b._pct - a._pct));
  }

  // 相違点(distinct)を症状トークンに分解（、, 区切り）
  function distinctTokens(s) {
    return (s.distinct || '').split(/[、,]/).map(t => t.trim()).filter(Boolean);
  }
  function getDistinctChecks() { try { return JSON.parse(localStorage.getItem('mos_distinct_checks') || '{}'); } catch (e) { return {}; } }
  function setDistinctChecks(o) { try { localStorage.setItem('mos_distinct_checks', JSON.stringify(o)); } catch (e) {} }

  // 全証を横断して得点化し降順で返す（鑑別エンジン同型）。
  //   base   … 属するグループの軸スコア(%/10)×重み(main=1 / aux=0.6 / obvious=0.4)
  //   distinct一致 … チェックされた相違点トークン1つ +2
  //   舌脈一致 … 入力した脈の強さ・舌の色・舌の形が証の記載と合致すれば1項目+1（最大+3）
  function buildCandidates() {
    const groups = relevantGroups();
    const wmul = { main: 1, aux: 0.6, obvious: 0.4 };
    const checks = getDistinctChecks();
    const cands = [];
    groups.forEach(g => {
      const base = (g._pct / 10) * (wmul[g.clinical_weight] || 1);
      (g.syndromes || []).forEach(s => {
        const toks = distinctTokens(s);
        const matched = (checks[s.id] || []).filter(t => toks.includes(t)).length;
        const tp = tonguePulseMatch(s);
        cands.push({ s, group: g.group, weight: g.clinical_weight, axes: g._axes, base, matched, tpScore: tp.score, tpMatched: tp.matched, total: base + matched * 2 + tp.score, toks });
      });
    });
    return cands.sort((a, b) => (b.total - a.total) || a.s.name.localeCompare(b.s.name, 'ja'));
  }

  // 選択中の証をカルテ等で再利用できるよう localStorage に保存
  // 証名・選穴だけでなく、根拠（該当した相違点・舌脈所見の一致）も残す（確定証サマリだけでは判断根拠が消えるため）
  function saveBianzhengResult(id) {
    id = id || getSelected();
    if (!id || !BIANZHENG) { try { localStorage.removeItem('mos_bianzheng_result'); } catch (e) {} return; }
    let found = null, grp = null;
    BIANZHENG.groups.forEach(g => (g.syndromes || []).forEach(s => { if (s.id === id) { found = s; grp = g; } }));
    if (!found) return;
    const checks = getDistinctChecks();
    const matchedDistinct = (checks[id] || []).filter(t => distinctTokens(found).includes(t));
    const tp = getTonguePulse();
    const tpm = tonguePulseMatch(found);
    const result = {
      group: grp.group, syndrome_id: found.id, syndrome: found.name,
      points: found.points, technique: found.technique,
      points_detail: found.points.map(n => Object.assign({ name: n }, (ACUPOINTS && ACUPOINTS.points[n]) || {})),
      matched_distinct: matchedDistinct,
      tongue_pulse_input: tp,
      tongue_pulse_matched: tpm.matched,
      saved_at: new Date().toLocaleString('ja-JP')
    };
    try { localStorage.setItem('mos_bianzheng_result', JSON.stringify(result)); } catch (e) {}
  }

  // 舌・脈の所見入力カード（tcm_findings.json の enum を再利用。カルテの刺激量決定と同じ所見）
  function tonguePulseCardHtml() {
    if (!TCM_FINDINGS) return '';
    const opts = arr => ['<option value="">未選択</option>'].concat((arr || []).map(o => `<option value="${o}">${o}</option>`)).join('');
    return `<section class="card" id="mos-tonguepulse">
      <h2>舌・脈の所見</h2>
      <p class="lead">証候候補の順位に反映します（未入力でも候補は表示されます）。</p>
      <div class="k-field"><span class="k-label">脈の強さ</span><select id="tp-strength">${opts(TCM_FINDINGS.pulse && TCM_FINDINGS.pulse._enum_strength)}</select></div>
      <div class="k-field"><span class="k-label">舌の色</span><select id="tp-color">${opts(TCM_FINDINGS.tongue && TCM_FINDINGS.tongue._enum_color)}</select></div>
      <div class="k-field"><span class="k-label">舌の形</span><select id="tp-shape">${opts(TCM_FINDINGS.tongue && TCM_FINDINGS.tongue._enum_shape)}</select></div>
    </section>`;
  }

  function renderBianzheng() {
    const out = document.getElementById('mos-bianzheng');
    if (!out) return;
    if (!BIANZHENG || !ACUPOINTS) { out.hidden = true; return; }
    out.hidden = false;

    const cands = buildCandidates();
    if (!cands.length) {
      out.innerHTML = `<h2>証候候補（得点降順）</h2>
        <p class="hint">回答を入力して「結果を見る」を押すと、MOSスコアから証候候補を上位順に並べます。</p>`;
      return;
    }

    // 明示選択が無ければ最有力(先頭)を開いて選穴を表示
    const effSel = getSelected() || cands[0].s.id;
    const maxTotal = Math.max.apply(null, cands.map(c => c.total).concat(1));
    const checks = getDistinctChecks();
    const wtag = w => w === 'aux' ? '<span class="tag light">心系・参考</span>'
      : w === 'obvious' ? '<span class="tag light">肺系・自明</span>' : '';

    const cardsHtml = cands.map((c, i) => {
      const s = c.s, on = s.id === effSel;
      const checkedToks = checks[s.id] || [];
      const tokHtml = c.toks.map((t, ti) =>
        `<label class="bz-tok"><input type="checkbox" data-syn="${s.id}" data-tok="${ti}" ${checkedToks.includes(t) ? 'checked' : ''}> ${t}</label>`).join('');
      const detail = on ? `
        <div class="bz-detail">
          ${s.common ? `<div class="bz-line"><b>共通</b>${s.common}</div>` : ''}
          ${s.tongue_pulse ? `<div class="bz-line"><b>舌脈</b>${s.tongue_pulse}</div>` : ''}
          ${c.tpMatched.length ? `<div class="bz-line"><b>舌脈一致</b>${c.tpMatched.join('・')}</div>` : ''}
          <div class="bz-points"><b>選穴例</b> ${s.points.map(pointHtml).join('')}</div>
          <div class="bz-line"><b>手技</b>${s.technique}</div>
        </div>` : '';
      return `
        <div class="bz-cand ${on ? 'on' : ''} ${i === 0 ? 'top' : ''}">
          <button class="bz-cand-head" data-open="${s.id}">
            <span class="rank-badge">${i === 0 ? '最有力' : '#' + (i + 1)}</span>
            <span class="bz-cand-name">${s.name}</span>
            <span class="tag light">${c.group}</span>${wtag(c.weight)}
            ${c.tpScore > 0 ? `<span class="tag light">舌脈+${c.tpScore}</span>` : ''}
            <span class="score-pill">${c.total.toFixed(0)}</span>
          </button>
          <div class="bar"><div class="bar-fill" style="width:${Math.round(c.total / maxTotal * 100)}%"></div></div>
          <div class="bz-toks">${tokHtml}</div>
          ${detail}
        </div>`;
    }).join('');

    out.innerHTML = `
      <h2>証候候補（得点降順）</h2>
      <p class="lead">MOSスコアで証候グループを順位づけ。各証の<b>相違点</b>に当てはまるものをチェックすると、順位がリアルタイムで精密化します。証名をタップで選穴例を表示（確定証ではなく示唆）。</p>
      ${cardsHtml}`;

    // 相違点チェック → 加点して再ランク
    out.querySelectorAll('input[data-tok]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.syn;
        const cand = cands.find(c => c.s.id === id);
        const tok = cand.toks[Number(cb.dataset.tok)];
        const ch = getDistinctChecks();
        const set = new Set(ch[id] || []);
        cb.checked ? set.add(tok) : set.delete(tok);
        ch[id] = [...set];
        if (!ch[id].length) delete ch[id];
        setDistinctChecks(ch);
        // 即時フィードバック：このカードの点数をその場更新（並べ替えはデバウンス）
        const cardEl = cb.closest('.bz-cand');
        const matched = (ch[id] || []).filter(t => cand.toks.includes(t)).length;
        cand.total = cand.base + matched * 2 + (cand.tpScore || 0);
        const sp = cardEl && cardEl.querySelector('.score-pill');
        if (sp) sp.textContent = cand.total.toFixed(0);
        // 入力が落ち着いたら一度だけ再ランク（カードが毎クリック飛ぶのを防ぐ）
        clearTimeout(rerankTimer);
        rerankTimer = setTimeout(renderBianzheng, 600);
      });
    });
    // 証名タップ → 開いて選穴表示＋保存（同じものを再タップで先頭に戻る）
    out.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.open;
        setSelected(getSelected() === id ? '' : id);
        renderBianzheng();
      });
    });

    saveBianzhengResult(effSel);
  }

  function questionHtml(q) {
    return `<div class="mos-q">
      <span class="mos-qno">${q.no}</span>
      <span class="mos-qtext">${q.text}</span>
      <div class="mos-opts">
        ${Object.keys(SCALE).map(label =>
          `<label class="k-check"><input type="radio" name="mosq-${q.no}" value="${SCALE[label]}"> ${label}</label>`).join('')}
      </div>
    </div>`;
  }

  function render() {
    const mode = getMode();
    const secHtml = QUESTIONS.sections.map(s => {
      const isL = s.conditional === 'female_with_menstruation';
      return `<section class="card mos-section" data-section="${s.section}" ${isL ? 'data-conditional="L"' : ''}>
        <h3>${s.section}　${s.label}</h3>
        ${isL ? '<p class="hint">月経のある女性（Fスケール）のみ回答。</p>' : ''}
        ${s.questions.map(questionHtml).join('')}
      </section>`;
    }).join('');

    root().innerHTML = `
      <section class="card">
        <h2>${QUESTIONS.title}</h2>
        <p class="lead">各問を3段階で回答（常にある=2／時々ある=1／ない=0）。51問の加点式で弁証傾向を算出します。</p>
        <div class="k-field"><span class="k-label">スケール</span>
          <select id="mos-mode">
            <option value="M">Mスケール（標準）</option>
            <option value="F">Fスケール（月経のある女性）</option>
          </select>
        </div>
      </section>
      ${secHtml}
      <div class="actions">
        <button class="btn primary" id="mos-calc">結果を見る ↓</button>
        <button class="btn" id="mos-clear">🗑 回答をクリア</button>
      </div>
      <section class="card" id="mos-profile"></section>
      ${tonguePulseCardHtml()}
      <section class="card" id="mos-bianzheng" hidden></section>`;

    // 復元
    const ans = loadAnswers();
    Object.keys(ans).forEach(no => {
      const el = document.querySelector(`input[name="mosq-${no}"][value="${ans[no]}"]`);
      if (el) el.checked = true;
    });
    document.getElementById('mos-mode').value = mode;
    applyMode(mode);

    // 舌・脈所見の復元＋変更で証候候補を再ランク
    const tp = getTonguePulse();
    const tpFieldMap = { 'tp-strength': 'strength', 'tp-color': 'tongue_color', 'tp-shape': 'tongue_shape' };
    Object.keys(tpFieldMap).forEach(elId => {
      const el = document.getElementById(elId);
      if (!el) return;
      el.value = tp[tpFieldMap[elId]] || '';
      el.addEventListener('change', () => {
        const cur = getTonguePulse();
        cur[tpFieldMap[elId]] = el.value;
        setTonguePulse(cur);
        renderBianzheng();
      });
    });

    root().addEventListener('change', e => {
      const t = e.target;
      if (t.name && t.name.startsWith('mosq-')) {
        const no = t.name.slice(5);
        const a = loadAnswers(); a[no] = Number(t.value); saveAnswers(a);
        renderProfile();
      }
    });
    document.getElementById('mos-mode').addEventListener('change', e => {
      setMode(e.target.value); applyMode(e.target.value); renderProfile(); renderBianzheng();
    });
    document.getElementById('mos-calc').addEventListener('click', () => {
      renderProfile(); renderBianzheng();
      document.getElementById('mos-profile').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('mos-clear').addEventListener('click', () => {
      if (!confirm('MOSの回答をすべて消去しますか？')) return;
      try { localStorage.removeItem(ANSWERS_KEY); } catch (e) {}
      render();
    });
    renderProfile();
    renderBianzheng();
  }

  // Fスケールでのみ L セクションを有効化
  function applyMode(mode) {
    const lSec = document.querySelector('.mos-section[data-conditional="L"]');
    if (!lSec) return;
    const disabled = mode !== 'F';
    lSec.style.opacity = disabled ? '0.5' : '1';
    lSec.querySelectorAll('input').forEach(i => { i.disabled = disabled; });
  }

  async function init() {
    try {
      [QUESTIONS, SCORING, BIANZHENG, ACUPOINTS, TCM_FINDINGS] = await Promise.all([
        fetch('data/mos_questions.json').then(r => r.json()),
        fetch('data/mos_scoring.json').then(r => r.json()),
        fetch('data/tcm_bianzheng.json').then(r => r.json()).catch(() => null),
        fetch('data/acupoints.json').then(r => r.json()).catch(() => null),
        fetch('data/tcm_findings.json').then(r => r.json()).catch(() => null)
      ]);
      render();
    } catch (e) {
      root().innerHTML = `<div class="card error">MOSデータの読み込みに失敗しました：${e.message}</div>`;
    }
  }

  init();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
  }
})();
