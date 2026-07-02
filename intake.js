/* =====================================================================
   問診ウィザード
   intake_flow.json の質問を提示 → 回答 → 導出ルールで karte の
   Step1・2・4・5・6 を自動充填（localStorage: karte_form_data）。
   Step3(疾患把握) は既存の鑑別エンジン(index.html)へ誘導。
   ===================================================================== */

const app = () => document.getElementById('intake');
const FORM_KEY = 'karte_form_data';
const INTAKE_KEY = 'intake_answers';
let FLOW = null, KARTE = null;
let LAST_LEVEL_BASIS = ''; // Step5 痛みレベルの得点内訳（完了画面で根拠表示）
let LAST_ACUTE_PHASE = '';    // Step1 急性の層別（超急性/急性/亜急性）
let LAST_REDFLAG_TIER = '';   // Step4 レッドフラッグの危険度サマリ
let LAST_TISSUE_WARNING = ''; // Step2予想組織 と 鑑別治療方針 の不一致警告

// 問診の回答を保存／復元（再開できるように）
function saveIntake() {
  const a = {};
  app().querySelectorAll('input').forEach(el => {
    if (el.type === 'radio') { if (el.checked) a[el.name] = el.value; }
    else if (el.type === 'checkbox') { if (el.checked) (a[el.name] = a[el.name] || []).push(el.value); }
    else if (el.type === 'number') { if (el.value) a[el.id] = el.value; }
  });
  app().querySelectorAll('select').forEach(el => { if (el.id && el.value) a[el.id] = el.value; });
  try { localStorage.setItem(INTAKE_KEY, JSON.stringify(a)); } catch (e) {}
}
function restoreIntake() {
  let a; try { a = JSON.parse(localStorage.getItem(INTAKE_KEY) || 'null'); } catch (e) {}
  if (!a) return;
  Object.keys(a).forEach(k => {
    const v = a[k];
    const byId = document.getElementById(k);
    if (byId && (byId.type === 'number' || byId.tagName === 'SELECT')) { byId.value = v; return; }
    app().querySelectorAll(`[name="${k}"]`).forEach(el => {
      if (el.type === 'radio') el.checked = (el.value === v);
      else if (el.type === 'checkbox') { if (Array.isArray(v) && v.includes(el.value)) el.checked = true; }
    });
  });
}

// karte の _enum_ から、answer が前方一致する正式値を返す（無ければ answer のまま）
function enumMatch(sectionObj, fieldKey, answer) {
  const arr = sectionObj && sectionObj['_enum_' + fieldKey];
  if (!arr) return answer;
  return arr.find(o => o === answer || o.startsWith(answer) || o.includes(answer)) || answer;
}
function tissueBase(t) { return t.split('(')[0].split('（')[0]; } // "神経(慢性…)"→"神経"

function qInput(q) {
  const id = q.id;
  if (q.input_type === 'boolean') {
    return `<div class="opt-row">
      <label class="k-check"><input type="radio" name="${id}" value="はい"> はい</label>
      <label class="k-check"><input type="radio" name="${id}" value="いいえ"> いいえ</label></div>`;
  }
  if (q.input_type === 'duration') {
    return `<div class="opt-row"><input type="number" min="0" id="${id}" class="dur" placeholder="数値">
      <select id="${id}_unit" class="dur-unit"><option value="日">日</option><option value="週">週</option><option value="ヶ月" selected>ヶ月</option></select></div>`;
  }
  if (q.input_type === 'single_select') {
    return `<div class="opt-col">${q.options.map(o => `<label class="k-check"><input type="radio" name="${id}" value="${o}"> ${o}</label>`).join('')}</div>`;
  }
  if (q.input_type === 'multi_select') {
    return `<div class="opt-col">${q.options.map(o => `<label class="k-check"><input type="checkbox" name="${id}" value="${o}"> ${o}</label>`).join('')}</div>`;
  }
  return '';
}

function renderStep(step) {
  if (step.redirect) {
    return `<section class="card intake-step" id="step-${step.step}" data-stepnum="${step.step}"><div class="step-tag">STEP ${step.step} / 6</div><h2>${step.title}（鑑別）</h2>
      <p class="lead">下の鑑別を進め、結果画面の「問診の続き（Step4）へ」でStep4に進みます。</p>
      <iframe id="diff-frame" class="diff-frame" title="鑑別エンジン"></iframe></section>`;
  }
  const qs = step.questions.map(q => `
    <div class="q-block">
      <p class="q-text">${q.text}</p>
      ${qInput(q)}
      ${q.note ? `<p class="hint">${q.note}</p>` : ''}
    </div>`).join('');
  return `<section class="card intake-step" id="step-${step.step}" data-stepnum="${step.step}"><div class="step-tag">STEP ${step.step} / 6</div><h2>${step.title}</h2>${qs}</section>`;
}

// ---- 回答取得 ----
function radioVal(id) { const el = document.querySelector(`input[name="${id}"]:checked`); return el ? el.value : null; }
function checkVals(id) { return [...document.querySelectorAll(`input[name="${id}"]:checked`)].map(e => e.value); }
function boolYes(id) { return radioVal(id) === 'はい'; }

// ---- 導出 → karte_form_data 書き込み ----
function deriveAndWrite() {
  const out = {};
  const kp = KARTE; // セクションごとの enum 参照用
  LAST_LEVEL_BASIS = LAST_ACUTE_PHASE = LAST_REDFLAG_TIER = LAST_TISSUE_WARNING = '';

  // Step1: 急性/慢性（単位 日/週/ヶ月 に対応。月換算で分類し、急性期の層別も残す）
  const dur = document.getElementById('q1_1');
  if (dur && dur.value !== '') {
    const n = Number(dur.value);
    const unit = (document.getElementById('q1_1_unit') || {}).value || 'ヶ月';
    const months = unit === '日' ? n / 30 : unit === '週' ? n * 7 / 30 : n;
    out['step1_acute_chronic.pain_duration'] = n + unit;
    out['step1_acute_chronic.classification'] = months <= 3 ? '急性(3ヶ月以下)' : '慢性(3ヶ月以上)';
    // 急性の中の層別（治療方針が変わるため保持）
    LAST_ACUTE_PHASE = months > 3 ? '' : (months <= 1 / 7 ? '超急性期(48時間以内目安)' : months <= 0.5 ? '急性期' : months <= 3 ? '亜急性期' : '');
  }

  // Step2: 予想組織
  const s2 = kp.step2_tissue_prediction;
  const q21 = radioVal('q2_1'), q22 = radioVal('q2_2'), q23 = checkVals('q2_3');
  if (q21) out['step2_tissue_prediction.pain_quality'] = enumMatch(s2, 'pain_quality', q21);
  if (q22) out['step2_tissue_prediction.pain_range'] = enumMatch(s2, 'pain_range', q22);
  if (q23.length) out['step2_tissue_prediction.aggravation_factor'] = q23.join(' / ');
  // tissue_hint 集計：和集合ではなく、ヒント頻度でランク付け（複数の回答が指す組織ほど上位＝最も疑わしい）
  const hintFor = (qid) => (FLOW.flow.flatMap(st => st.questions || []).find(q => q.id === qid) || {}).tissue_hint || {};
  const tissueScore = {};
  const collect = (hint, ans) => {
    if (!ans) return;
    const key = Object.keys(hint).find(k => ans === k || ans.startsWith(k) || ans.includes(k));
    if (key) hint[key].forEach(t => { const b = tissueBase(t); tissueScore[b] = (tissueScore[b] || 0) + 1; });
  };
  collect(hintFor('q2_1'), q21);
  collect(hintFor('q2_2'), q22);
  q23.forEach(a => collect(hintFor('q2_3'), a));
  const rankedTissues = Object.keys(tissueScore)
    .sort((a, b) => (tissueScore[b] - tissueScore[a]) || a.localeCompare(b, 'ja'));
  if (rankedTissues.length) out['step2_tissue_prediction.predicted_tissue'] = rankedTissues;

  // 予想組織を鑑別エンジン出力(engine_output)にも橋渡し → カルテ「原因組織」へ流れる。
  // 鑑別エンジンは疾患マスタに組織情報を持たず cause_tissue=null で来るため、ここで補完する（頻度順）。
  if (rankedTissues.length) {
    try {
      const eng = JSON.parse(localStorage.getItem('karte_engine_output') || 'null');
      if (eng && (eng.cause_tissue == null || (Array.isArray(eng.cause_tissue) && !eng.cause_tissue.length))) {
        eng.cause_tissue = rankedTissues;
        localStorage.setItem('karte_engine_output', JSON.stringify(eng));
      }
    } catch (e) {}
  }

  // ③ 問診の予想組織 と 鑑別エンジンの治療方針 の整合チェック（矛盾を見落とさない）
  if (rankedTissues.length) {
    try {
      const eng = JSON.parse(localStorage.getItem('karte_engine_output') || 'null');
      const track = eng && eng.treatment_track;
      const EXPECT = { '局所筋骨格': ['筋肉', '骨', '関節', '靭帯'], '神経系': ['神経'], '心理社会的': ['精神'], '自律神経': ['内臓', '精神'] };
      if (track && EXPECT[track]) {
        const top = rankedTissues[0];
        if (!EXPECT[track].includes(top)) {
          LAST_TISSUE_WARNING = `問診の予想組織（${rankedTissues.slice(0, 2).join('・')}）と鑑別の治療方針（${track}）が一致しません。再確認を推奨します。`;
        }
      }
    } catch (e) {}
  }

  // Step4: レッドフラッグ（危険度で重み付け → 要緊急受診 / 要注意 の段階サマリ）
  // 膀胱直腸障害(q4_6)=馬尾、運動障害(q4_2)=神経障害、48時間以上進行(q4_5)=進行性 は緊急度が高い。
  const URGENT_RF = new Set(['q4_2', 'q4_5', 'q4_6']);
  const rfDefs = FLOW.flow.find(s => s.step === 4).questions;
  let rfFlags = [];
  let urgentHit = false;
  rfDefs.forEach(q => {
    const key = q.karte_field;
    if (q.input_type === 'boolean') {
      const yes = boolYes(q.id);
      out[key] = radioVal(q.id) || '';
      if (yes && q.flag_if_yes) { rfFlags.push(q.flag_if_yes); if (URGENT_RF.has(q.id)) urgentHit = true; }
    } else if (q.input_type === 'single_select') {
      const v = radioVal(q.id);
      if (v) out[key] = v;
      if (v && q.flag_if && q.flag_if[v]) { rfFlags.push(q.flag_if[v]); if (URGENT_RF.has(q.id)) urgentHit = true; }
    }
  });
  if (rfDefs.some(q => radioVal(q.id) !== null)) {
    out['step4_red_flag.present'] = rfFlags.length ? 'あり' : 'なし';
    LAST_REDFLAG_TIER = !rfFlags.length ? '経過可（レッドフラッグなし）'
      : urgentHit ? '🔴 要緊急受診' : '🟡 要注意';
    if (rfFlags.length) out['step4_red_flag.content'] = `【${urgentHit ? '要緊急受診' : '要注意'}】` + rfFlags.join(' / ');
  }

  // Step5: 痛みのレベル（末梢/脊髄/脳）
  // 「脳の票が1つでもあれば脳」ではなく重み付きスコアで判定。
  // 痛みの分布(q5_1)は最も本質的な指標なので重み2、その他は重み1。同点は高位を採用（中枢性の見落とし回避）。
  const lvDefs = FLOW.flow.find(s => s.step === 5).questions;
  const levelScore = { '末梢神経レベル': 0, '脊髄レベル': 0, '脳レベル': 0 };
  let levelAnswered = false;
  lvDefs.forEach(q => {
    const key = q.karte_field;
    const w = q.id === 'q5_1' ? 2 : 1;
    if (q.input_type === 'single_select') {
      const v = radioVal(q.id);
      if (v) { out[key] = v; levelAnswered = true; if (q.level_map && q.level_map[v]) levelScore[q.level_map[v]] += w; }
    } else if (q.input_type === 'boolean') {
      out[key] = radioVal(q.id) || '';
      if (radioVal(q.id) !== null) levelAnswered = true;
      if (boolYes(q.id) && q.level_if_yes) q.level_if_yes.forEach(l => { if (l in levelScore) levelScore[l] += w; });
    }
  });
  if (levelAnswered) {
    const order = ['末梢神経レベル', '脊髄レベル', '脳レベル'];
    let best = order[0];
    order.forEach(l => { if (levelScore[l] >= levelScore[best]) best = l; }); // 同点は高位優先
    out['step5_pain_level.level'] = best;
    LAST_LEVEL_BASIS = order.filter(l => levelScore[l] > 0)
      .map(l => `${l.replace('レベル', '')}:${levelScore[l]}`).join(' / ');
  }

  // Step6: イエローフラッグ
  const yfDefs = FLOW.flow.find(s => s.step === 6).questions;
  let yfYes = 0;
  yfDefs.forEach(q => { out[q.karte_field] = radioVal(q.id) || ''; if (boolYes(q.id)) yfYes++; });
  if (yfDefs.some(q => radioVal(q.id) !== null)) {
    out['step6_yellow_flag.result'] = yfYes === 0 ? '特記なし'
      : `${yfYes}項目該当` + (yfYes >= 2 ? '：セルフケア等の患者教育を推奨' : '');
  }

  // 既存下書きにマージして保存
  let cur = {};
  try { cur = JSON.parse(localStorage.getItem(FORM_KEY) || '{}'); } catch (e) {}
  const merged = Object.assign({}, cur, out);
  try { localStorage.setItem(FORM_KEY, JSON.stringify(merged)); } catch (e) {}
  return out;
}

async function init() {
  try {
    [FLOW, KARTE] = await Promise.all([
      fetch('data/intake_flow.json').then(r => r.json()),
      fetch('data/karte_schema.json').then(r => r.json())
    ]);
    // 全ステップを描画（DOMには常に保持＝集計は全回答を参照）。表示は1ステップずつ。
    let html = FLOW.flow.map(renderStep).join('');
    html += `<section class="card intake-step" id="step-done" data-stepnum="done" hidden>
      <h2>問診完了</h2><div id="summary"></div></section>`;
    html += `<div class="actions" id="wiz-nav">
      <button class="btn" id="wiz-back">← 戻る</button>
      <button class="btn primary" id="wiz-next">次へ →</button>
    </div>`;
    app().innerHTML = html;

    restoreIntake();
    app().addEventListener('input', saveIntake);
    app().addEventListener('change', saveIntake);

    // ---- 1ステップずつ表示するウィザード制御 ----
    const stepEls = [...document.querySelectorAll('.intake-step')]; // 6問診 + done
    const lastIdx = stepEls.length - 1; // done
    const back = document.getElementById('wiz-back');
    const next = document.getElementById('wiz-next');

    function showStep(i) {
      i = Math.max(0, Math.min(lastIdx, i));
      stepEls.forEach((el, n) => { el.hidden = (n !== i); });
      back.style.visibility = i === 0 ? 'hidden' : 'visible';
      // 最終ステップ(done)の手前(Step6)では「完了」、doneでは非表示
      if (i === lastIdx) { next.hidden = true; }
      else { next.hidden = false; next.textContent = (i === lastIdx - 1) ? '完了してカルテへ →' : '次へ →'; }
      try { localStorage.setItem('intake_step', String(i)); } catch (e) {}
      // Step3 表示時に鑑別 iframe を遅延ロード
      const cur = stepEls[i];
      if (cur && cur.dataset.stepnum === '3') {
        const f = cur.querySelector('#diff-frame');
        if (f && !f.src) f.src = 'index.html';
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    const indexOfStepNum = n => stepEls.findIndex(el => el.dataset.stepnum === String(n));

    // 鑑別から戻った場合は Step4 を表示、それ以外は保存済みステップを復元
    let startIdx = 0;
    let returned = false;
    try { returned = localStorage.getItem('intake_return') === '1'; } catch (e) {}
    if (returned) { startIdx = indexOfStepNum(4); try { localStorage.removeItem('intake_return'); } catch (e) {} }
    else { try { startIdx = Number(localStorage.getItem('intake_step') || 0) || 0; } catch (e) {} }
    showStep(startIdx);

    back.addEventListener('click', () => showStep(stepEls.findIndex(el => !el.hidden) - 1));
    next.addEventListener('click', () => {
      const cur = stepEls.findIndex(el => !el.hidden);
      if (cur === lastIdx - 1) { finish(); return; } // Step6 → 完了
      showStep(cur + 1);
    });

    // 鑑別 iframe からの完了通知 → Step4 へ自動遷移
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'intake-continue') {
        const i = indexOfStepNum(4);
        if (i >= 0) showStep(i);
      }
    });

    // 完了：カルテへ反映して遷移
    function finish() {
      const out = deriveAndWrite();
      const keys = Object.keys(out);
      const sm = document.getElementById('summary');
      sm.innerHTML = keys.length
        ? `<p class="lead">カルテに反映しました。</p><ul class="hit-list">${keys.map(k =>
            `<li><span>${k.split('.').pop()}</span><span>${Array.isArray(out[k]) ? out[k].join('・') : out[k]}</span></li>`).join('')}</ul>
           ${LAST_ACUTE_PHASE ? `<p class="hint">急性期の層別：${LAST_ACUTE_PHASE}</p>` : ''}
           ${LAST_REDFLAG_TIER ? `<p class="hint">レッドフラッグ危険度：${LAST_REDFLAG_TIER}</p>` : ''}
           ${LAST_LEVEL_BASIS ? `<p class="hint">痛みレベルの得点内訳：${LAST_LEVEL_BASIS}（判定：${out['step5_pain_level.level'] || '—'}）</p>` : ''}
           ${LAST_TISSUE_WARNING ? `<div class="alert yellow"><strong>⚠ 組織予想と鑑別の不一致</strong><p>${LAST_TISSUE_WARNING}</p></div>` : ''}
           <div class="actions"><a class="btn primary" href="karte.html">🗂 カルテを開く →</a></div>`
        : `<p class="lead">回答が少なく反映項目はありません。</p><div class="actions"><a class="btn" href="karte.html">🗂 カルテを開く</a></div>`;
      try { localStorage.removeItem('intake_step'); } catch (e) {}
      showStep(lastIdx);
    }
  } catch (e) {
    app().innerHTML = `<div class="card error">問診フローの読み込みに失敗しました：${e.message}</div>`;
  }
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
