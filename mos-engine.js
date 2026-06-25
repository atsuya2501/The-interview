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
  let QUESTIONS = null, SCORING = null, BIANZHENG = null, ACUPOINTS = null;
  let rerankTimer = null; // 相違点チェックの再ランクをデバウンス
  const BZ_SELECTED_KEY = 'mos_selected_syndrome';

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
        cands.push({ s, group: g.group, weight: g.clinical_weight, axes: g._axes, base, matched, total: base + matched * 2, toks });
      });
    });
    return cands.sort((a, b) => (b.total - a.total) || a.s.name.localeCompare(b.s.name, 'ja'));
  }

  // 選択中の証をカルテ等で再利用できるよう localStorage に保存
  function saveBianzhengResult(id) {
    id = id || getSelected();
    if (!id || !BIANZHENG) { try { localStorage.removeItem('mos_bianzheng_result'); } catch (e) {} return; }
    let found = null, grp = null;
    BIANZHENG.groups.forEach(g => (g.syndromes || []).forEach(s => { if (s.id === id) { found = s; grp = g; } }));
    if (!found) return;
    const result = {
      group: grp.group, syndrome_id: found.id, syndrome: found.name,
      points: found.points, technique: found.technique,
      points_detail: found.points.map(n => Object.assign({ name: n }, (ACUPOINTS && ACUPOINTS.points[n]) || {})),
      saved_at: new Date().toLocaleString('ja-JP')
    };
    try { localStorage.setItem('mos_bianzheng_result', JSON.stringify(result)); } catch (e) {}
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
          <div class="bz-points"><b>選穴例</b> ${s.points.map(pointHtml).join('')}</div>
          <div class="bz-line"><b>手技</b>${s.technique}</div>
        </div>` : '';
      return `
        <div class="bz-cand ${on ? 'on' : ''} ${i === 0 ? 'top' : ''}">
          <button class="bz-cand-head" data-open="${s.id}">
            <span class="rank-badge">${i === 0 ? '最有力' : '#' + (i + 1)}</span>
            <span class="bz-cand-name">${s.name}</span>
            <span class="tag light">${c.group}</span>${wtag(c.weight)}
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
        cand.total = cand.base + matched * 2;
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
      <section class="card" id="mos-bianzheng" hidden></section>`;

    // 復元
    const ans = loadAnswers();
    Object.keys(ans).forEach(no => {
      const el = document.querySelector(`input[name="mosq-${no}"][value="${ans[no]}"]`);
      if (el) el.checked = true;
    });
    document.getElementById('mos-mode').value = mode;
    applyMode(mode);

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
      [QUESTIONS, SCORING, BIANZHENG, ACUPOINTS] = await Promise.all([
        fetch('data/mos_questions.json').then(r => r.json()),
        fetch('data/mos_scoring.json').then(r => r.json()),
        fetch('data/tcm_bianzheng.json').then(r => r.json()).catch(() => null),
        fetch('data/acupoints.json').then(r => r.json()).catch(() => null)
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
