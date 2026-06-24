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
  let QUESTIONS = null, SCORING = null;

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
      <section class="card" id="mos-profile"></section>`;

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
      setMode(e.target.value); applyMode(e.target.value); renderProfile();
    });
    document.getElementById('mos-calc').addEventListener('click', () => {
      renderProfile();
      document.getElementById('mos-profile').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('mos-clear').addEventListener('click', () => {
      if (!confirm('MOSの回答をすべて消去しますか？')) return;
      try { localStorage.removeItem(ANSWERS_KEY); } catch (e) {}
      render();
    });
    renderProfile();
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
      [QUESTIONS, SCORING] = await Promise.all([
        fetch('data/mos_questions.json').then(r => r.json()),
        fetch('data/mos_scoring.json').then(r => r.json())
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
