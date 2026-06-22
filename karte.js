/* =====================================================================
   カルテ様式シェル
   karte_schema.json / tcm_findings.json からフォームを自動生成。
   ・日本語ラベル
   ・鑑別エンジン出力(localStorage: karte_engine_output)を engine_output 欄へ自動流し込み
   ・入力の自動保存(下書き) + 複数カルテの保存／呼び出し
   ・性別=男/女、生年月日(日付)→年齢を自動算出
   ===================================================================== */

const app = () => document.getElementById('karte');
const META = new Set(['schema_name', 'version', 'description', 'shared_by', 'master_type', 'fallback', 'architecture_note', 'severity_policy', 'level_handling']);
const STORAGE_KEY = 'karte_form_data';   // 作業中の下書き
const RECORDS_KEY = 'karte_records';      // 保存済みカルテ群
let STIM_MOD = null;                      // stimulus_modulation（刺激量サジェスト）
let TRACK_MECH = null, TREATMENTS = null, ELECTRO = null; // 治療プラン自動提案用

const LABELS = {
  profile: '基本情報', engine_output: '鑑別エンジン出力（自動入力）', checks: '確認項目',
  exam_physical: '徒手検査（錐体路・錐体外路）', exam_spinal: '脊髄系の診察', exam_bone: '骨の診察',
  exam_joint: '関節の診察', exam_muscle: '筋の診察', exam_psych: '精神面', notes: '備考',
  pulse: '脈', tongue: '舌', muscle_hardness: '硬さ（抗重力筋）',
  karte_no: 'カルテNo', name: '氏名', birth_date: '生年月日', age: '年齢', sex: '性別',
  disease_duration_years: '罹患期間（年）', chief_complaint: '主訴', diagnosis_name: '診断名',
  pain_duration: '痛みの持続期間', classification: '急性/慢性', pain_quality: '痛みの性質',
  pain_range: '痛みの範囲', relief_factor: '軽快因子', aggravation_factor: '増悪因子',
  predicted_tissue: '予想される組織',
  balre_sign: 'バレー徴候', pronation_supination: '回内・回外運動', pathological_reflex: '病的反射',
  reflex: '腱反射', muscle_strength: '筋力', sensory: '感覚', percussion_pain: '叩打痛',
  heat: '熱感', swelling: '腫脹', redness: '発赤', rom_test: 'ROMテスト', tenderness: '圧痛',
  interest_loss: '興味・関心の低下', pain_location_and_state: '部位と痛みの性状',
  region: '部位', branch: '分類', confirmed_disease: '示唆疾患', differential_candidates: '鑑別候補',
  cause_tissue: '原因組織', treatment_track: '治療トラック',
  present: 'レッドフラッグ', content: '内容', severe_pain: '激しい痛み', motor_disturbance: '運動障害',
  autonomic_reaction: '自律神経反応', widespread_pain: '全身/半身の痛み', progressive_48h: '48時間以上で悪化',
  bladder_bowel_dysfunction: '膀胱直腸障害',
  level: '痛みのレベル', pain_distribution: '痛みの分布', cold_symptoms: '冷え',
  postural_change_muscle_tension: '姿勢変化・筋緊張', diarrhea_constipation: '下痢・便秘',
  dry_mouth_eye: 'ドライマウス/アイ', weather_sensitivity: '天気で変化', emotion_sensitivity: '感情で変化',
  thought_related_change: '思考に関連して変化', sleep_disturbance: '睡眠障害',
  rest_until_cured: '治るまで休むべきと考える', limiting_activities: 'やりたいことを制限',
  rest_is_best: '安静が一番と考える', movement_worsens: '動くと悪化すると思う',
  past_work_absence: '痛みで休職した経験', constant_anxiety_tension: '常に不安・緊張',
  constant_depression: '常に憂うつ', heavy_or_monotonous_work: '重労働・単純作業', result: '結果',
  short_term: '短期目標', long_term: '長期目標', final: '最終目標', phase: '時期',
  strength: '脈の強さ', color: '舌の色', shape: '舌の形', value: '硬さ',
  treatment_location: '治療部位', tools_used: '使用する道具', mechanism: '機序',
  technique: '手技', needle_size: '鍼の太さ', treatment_time: '治療時間', other_options: 'その他',
  special_notes: '特記事項', past_history: '既往歴', family_history: '家族歴', medication: '服薬'
};

// パス単位のフィールド型上書き
const FIELD_OVERRIDES = {
  'profile.sex': { type: 'select', options: ['男', '女'] },
  'profile.birth_date': { type: 'birth' },
  'profile.age': { type: 'readonly' }
};

// 生年月日：西暦/月/日を別セレクトに（高齢者でも西暦を選びやすく）
function renderBirth() {
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now; y >= 1915; y--) years.push(y);
  const opt = (arr, suffix) => ['<option value=""></option>'].concat(arr.map(v => `<option value="${v}">${v}${suffix}</option>`)).join('');
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return `<div class="k-field"><span class="k-label">生年月日</span>
    <div class="opt-row birth-row">
      <select data-path="profile.birth_year">${opt(years, '年')}</select>
      <select data-path="profile.birth_month">${opt(months, '月')}</select>
      <select data-path="profile.birth_day">${opt(days, '日')}</select>
    </div>
    <input type="hidden" data-path="profile.birth_date"></div>`;
}

function labelFor(key) { return LABELS[key] || key.replace(/_/g, ' '); }

function renderField(path, key, val, enumArr) {
  const dp = `${path}.${key}`;
  const label = labelFor(key);
  const ov = FIELD_OVERRIDES[dp];

  if (ov) {
    if (ov.type === 'birth') return renderBirth();
    if (ov.type === 'readonly') return `<div class="k-field"><span class="k-label">${label}</span><input type="text" data-path="${dp}" readonly placeholder="生年月日から自動計算"></div>`;
    if (ov.type === 'select') {
      const opts = ['<option value=""></option>'].concat(ov.options.map(o => `<option>${o}</option>`)).join('');
      return `<div class="k-field"><span class="k-label">${label}</span><select data-path="${dp}">${opts}</select></div>`;
    }
  }

  if (Array.isArray(val)) {
    if (enumArr && enumArr.length) {
      const boxes = enumArr.map(opt => `
        <label class="k-check"><input type="checkbox" data-path="${dp}" value="${opt}"> ${opt}</label>`).join('');
      return `<div class="k-field"><span class="k-label">${label}</span><div class="k-checks">${boxes}</div></div>`;
    }
    return `<div class="k-field"><span class="k-label">${label}</span><textarea data-path="${dp}" rows="2" placeholder="自由記述（複数可）"></textarea></div>`;
  }
  if (enumArr && enumArr.length) {
    const opts = ['<option value=""></option>'].concat(enumArr.map(o => `<option>${o}</option>`)).join('');
    return `<div class="k-field"><span class="k-label">${label}</span><select data-path="${dp}">${opts}</select></div>`;
  }
  return `<div class="k-field"><span class="k-label">${label}</span><input type="text" data-path="${dp}" placeholder=""></div>`;
}

function renderSection(name, obj, depth, prefix) {
  const path = prefix ? `${prefix}.${name}` : name;
  const title = obj.label || labelFor(name);
  const fieldKeys = Object.keys(obj).filter(k => !k.startsWith('_') && k !== 'label');
  const body = fieldKeys.map(fk => {
    const val = obj[fk];
    const enumArr = obj['_enum_' + fk];
    if (val && typeof val === 'object' && !Array.isArray(val)) return renderSection(fk, val, depth + 1, path);
    return renderField(path, fk, val, enumArr);
  }).join('');
  const tag = depth === 0 ? 'section' : 'div';
  const cls = depth === 0 ? 'card k-section' : 'k-subsection';
  const ht = depth === 0 ? 'h2' : 'h3';
  return `<${tag} class="${cls}"><${ht}>${title}</${ht}>${body}</${tag}>`;
}

function renderTcm(tcm) {
  const blocks = ['pulse', 'tongue', 'muscle_hardness']
    .filter(k => tcm[k]).map(k => renderSection(k, tcm[k], 1, 'tcm')).join('');
  return `<section class="card k-section"><h2>東洋医学的所見（脈・舌・硬さ）</h2><p class="lead">刺激量・時期判定の参考。術者が記入。</p>${blocks}
    <div id="stim-suggest" class="obs-block" hidden></div></section>`;
}

// 脈・舌・硬さ → 時期(phase)＋刺激サジェスト（stimulus_modulation, 臨床経験ベース）
function updateStimulus() {
  const box = document.getElementById('stim-suggest');
  if (!box || !STIM_MOD) return;
  const val = dp => (document.querySelector(`[data-path="${dp}"]`) || {}).value || '';
  const pulse = val('tcm.pulse.strength');
  const tColor = val('tcm.tongue.color'), tShape = val('tcm.tongue.shape');
  const hard = val('tcm.muscle_hardness.value');
  if (!pulse && !tColor && !tShape && !hard) { box.hidden = true; return; }

  const pulseWeak = pulse === '弱い';
  const pulseNormal = pulse === '強い' || pulse === '正常';
  const tongueChanged = (tColor && tColor !== '正常') || (tShape && tShape !== '正常');

  const lines = [];
  if (pulse) {
    if (pulseWeak) lines.push('刺激方法：置鍼・鍉鍼・接触鍼（弱い刺激）', '本数/刺激量：少なめ', '深さ：浅め');
    else lines.push('刺激方法：鍼通電・雀啄（強めの手技も可）', '本数/刺激量：制限なし', '深さ：制限なし');
  }
  if (tColor || tShape) {
    if (tongueChanged) lines.push('治療部位：末梢に加え脊髄・脳レベルも必要（部位は絞る）');
    else lines.push('治療部位：末梢レベルで可（制限なし）');
  }
  if (hard === '硬い') lines.push('抗重力筋：交感神経関与のため浅めに刺鍼');

  let phase;
  if (pulseWeak) phase = '虚/疲労';
  else if (tongueChanged) phase = '慢性/慢性化傾向';
  else if (pulseNormal || tColor || tShape) phase = '急性';

  // phase をカルテ欄に自動入力
  const phaseEl = document.querySelector('[data-path="stimulus_decision.phase"]');
  if (phaseEl && phase) phaseEl.value = phase;

  box.hidden = false;
  box.innerHTML = `<p class="obs-h">🧭 刺激量サジェスト（脈・舌・硬さより／臨床経験ベース）</p>
    ${phase ? `<p>推定時期（phase）：<b>${phase}</b>${pulseWeak ? '（脈が弱い→急性/慢性に優先して弱刺激・浅め）' : ''}</p>` : ''}
    <ul class="hit-list">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
    <p class="hint">エビデンスではなく臨床経験に基づく参考（原著明記）。Step3鑑別とは別格。</p>`;
}

// ---- フォーム値の入出力 ----
function serializeForm() {
  const data = {};
  app().querySelectorAll('[data-path]').forEach(el => {
    const dp = el.dataset.path;
    if (el.type === 'checkbox') { if (el.checked) (data[dp] = data[dp] || []).push(el.value); }
    else if (el.value) data[dp] = el.value;
  });
  return data;
}
function applyData(data) {
  app().querySelectorAll('[data-path]').forEach(el => { if (el.type === 'checkbox') el.checked = false; else el.value = ''; });
  if (data) {
    Object.keys(data).forEach(dp => {
      const val = data[dp];
      app().querySelectorAll(`[data-path="${dp}"]`).forEach(el => {
        if (el.type === 'checkbox') { if (Array.isArray(val) && val.includes(el.value)) el.checked = true; }
        else el.value = val;
      });
    });
  }
  updateAge();
}
function saveForm() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeForm())); } catch (e) {} }
function restoreForm() { let d; try { d = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) {} if (d) applyData(d); }

// 生年月日（西暦/月/日セレクト）→ 年齢＋birth_date文字列
function updateAge() {
  const v = dp => (document.querySelector(`[data-path="${dp}"]`) || {}).value || '';
  const ageEl = document.querySelector('[data-path="profile.age"]');
  const bdEl = document.querySelector('[data-path="profile.birth_date"]');
  const y = v('profile.birth_year'), m = v('profile.birth_month'), d = v('profile.birth_day');
  if (bdEl) bdEl.value = y ? `${y}/${m || '?'}/${d || '?'}` : '';
  if (!ageEl) return;
  if (!y) { ageEl.value = ''; return; }
  const by = Number(y), bm = Number(m || 1), bd = Number(d || 1);
  const now = new Date();
  let age = now.getFullYear() - by;
  const mm = (now.getMonth() + 1) - bm;
  if (mm < 0 || (mm === 0 && now.getDate() < bd)) age--;
  ageEl.value = age >= 0 ? age + '歳' : '';
}

// 鑑別エンジン出力を流し込み
function prefillFromEngine() {
  let data; try { data = JSON.parse(localStorage.getItem('karte_engine_output') || 'null'); } catch (e) {}
  if (!data) return null;
  const set = (dp, v, onlyIfEmpty) => {
    if (v == null || v === '') return;
    const el = document.querySelector(`[data-path="${dp}"]`);
    if (!el || (onlyIfEmpty && el.value)) return;
    el.value = Array.isArray(v) ? v.join(' / ') : v;
  };
  const base = 'step3_disease.engine_output';
  set(`${base}.region`, data.region);
  set(`${base}.branch`, data.branch);
  set(`${base}.confirmed_disease`, data.confirmed_disease);
  set(`${base}.differential_candidates`, data.differential_candidates);
  set(`${base}.cause_tissue`, data.cause_tissue);
  set(`${base}.treatment_track`, data.treatment_track);
  set('profile.diagnosis_name', data.confirmed_disease, true);
  return data;
}

// ---- 複数カルテの保存／呼び出し ----
function loadRecords() { try { return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}'); } catch (e) { return {}; } }
function storeRecords(r) { try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); } catch (e) {} }
function refreshRecordList() {
  const sel = document.getElementById('rec-list');
  if (!sel) return;
  const recs = loadRecords();
  const ids = Object.keys(recs).sort((a, b) => Number(b) - Number(a));
  sel.innerHTML = ['<option value="">— 保存済みカルテを選択 —</option>']
    .concat(ids.map(id => `<option value="${id}">${recs[id].name}（${recs[id].at}）</option>`)).join('');
}

function buildControls() {
  return `<section class="card">
    <h2>カルテ保存 / 呼び出し</h2>
    <div class="k-field"><span class="k-label">保存名</span><input id="rec-name" type="text" placeholder="氏名・日付など（空なら自動）"></div>
    <div class="actions" style="margin-top:.4rem"><button class="btn primary" id="rec-save">💾 現在の内容を保存</button></div>
    <div class="k-field" style="margin-top:.6rem"><span class="k-label">保存済みカルテ</span><select id="rec-list"></select></div>
    <div class="actions"><button class="btn" id="rec-load">📂 呼び出し</button><button class="btn" id="rec-del">🗑 選択を削除</button></div>
    <div class="actions" style="margin-top:.4rem">
      <button class="btn" id="rec-export">⬇ 書き出し(JSON)</button>
      <button class="btn" id="rec-import">⬆ 読み込み(JSON)</button>
      <input type="file" id="rec-file" accept="application/json,.json" hidden>
    </div>
  </section>`;
}

// ---- 治療プラン自動提案（resolver: track_to_mechanism + electrotherapy_params） ----
function resolveTx(track, regionKey) {
  if (!TRACK_MECH || !TREATMENTS || !track) return null;
  const m = TRACK_MECH.mappings.find(x => x.track === track);
  if (!m) return null;
  if (m.treat === false || m.treat === 'redirect') return { info: m, txs: [] };
  const sec = [...(m.secondary || [])];
  if (m.ia_ib_conditional) {
    const regs = (TRACK_MECH.ia_ib_resolution || {}).applies_to_regions || [];
    if (regs.includes(regionKey)) sec.push('ia_ib_inhibition');
  }
  const primary = new Set(m.primary || []);
  const seen = new Set();
  const ids = [...(m.primary || []), ...sec].filter(id => !seen.has(id) && seen.add(id));
  const txs = ids.map(id => TREATMENTS.find(t => t.id === id)).filter(Boolean);
  return { info: m, txs, primary, reason: m.reason };
}

// 痛みタイプ → 下行性疼痛抑制の周波数バリアント選択（step5の回答から）
function pickDescVariant(variants) {
  const v = dp => (document.querySelector(`[data-path="${dp}"]`) || {}).value || '';
  const weather = v('step5_pain_level.checks.weather_sensitivity') === 'はい';
  const emotion = v('step5_pain_level.checks.emotion_sensitivity') === 'はい'
    || v('step5_pain_level.checks.thought_related_change') === 'はい';
  let receptor = 'μ';
  if (weather) receptor = 'κ'; else if (emotion) receptor = 'δ';
  return variants.find(x => x.receptor === receptor) || variants[0];
}

// 機序id → 鍼通電パラメータ文字列
function esText(id) {
  if (!ELECTRO) return '';
  const ps = ELECTRO.mechanism_params.filter(p => p.mechanism_id === id);
  if (!ps.length) return '';
  return ps.map(p => {
    if (p.frequency_variants) {
      const v = pickDescVariant(p.frequency_variants);
      return `${v.frequency_hz}・${p.intensity}・${v.time_min}分（${v.opioid || ''}/${v.receptor || ''}）`;
    }
    return `${p.frequency_hz}・${p.intensity}・${p.time_min}分${p.site ? '（' + p.site + '）' : ''}`;
  }).join(' ／ ');
}

// 治療プラン欄に自動提案パネルを差し込み＋手技/道具チェックを補助
function buildTreatmentSuggest() {
  let data; try { data = JSON.parse(localStorage.getItem('karte_engine_output') || 'null'); } catch (e) {}
  if (!data || !data.treatment_track) return;
  const sec = [...app().querySelectorAll('.k-section')].find(s => (s.querySelector('h2') || {}).textContent === '治療プラン');
  if (!sec) return;

  const r = resolveTx(data.treatment_track, data.region_key);
  const box = document.createElement('div');
  box.className = 'obs-block';

  if (!r || !r.txs.length) {
    const reason = r && r.info ? r.info.reason : '';
    box.innerHTML = `<p class="obs-h">🧭 治療プラン自動提案（${data.treatment_track}）</p>
      <p class="hint">鍼の機序候補なし（${reason || '医療機関紹介/参照トラック'}）。</p>`;
    sec.appendChild(box);
    return;
  }

  const rows = r.txs.map(t => {
    const es = esText(t.id);
    const pri = r.primary.has(t.id) ? '<span class="tag primary-tag">第一選択</span> ' : '';
    return `<div class="tx">
      <div class="tx-head">${pri}${t.mechanism} <span class="tag">${t.category}</span> <span class="tag light">${t.level}</span></div>
      <div class="tx-body">
        <div><b>刺激部位</b> ${t.stimulus_site}</div>
        <div><b>治療点</b> ${t.treatment_location}</div>
        <div><b>手技</b> ${t.technique}</div>
        <div><b>神経線維</b> ${t.nerve_fiber.join('・')}</div>
        ${es ? `<div><b>鍼通電</b> ${es}</div>` : ''}
      </div></div>`;
  }).join('');

  box.innerHTML = `<p class="obs-h">🧭 治療プラン自動提案（${data.treatment_track} → 機序）</p>
    ${r.reason ? `<p class="resolver-reason">${r.reason}</p>` : ''}
    ${rows}
    <p class="hint">候補提示です。下の手技・道具欄に一部自動チェックしました（術者が最終選択）。</p>`;
  sec.appendChild(box);

  // 手技・道具チェックの補助（文字列一致）
  const allTech = r.txs.map(t => t.technique).join(' ');
  document.querySelectorAll('[data-path="specific_treatment.technique"]').forEach(cb => {
    if (allTech.includes(cb.value)) cb.checked = true;
  });
  document.querySelectorAll('[data-path="treatment_plan.tools_used"]').forEach(cb => {
    if (cb.value === '鍼') cb.checked = true;
    else if (allTech.includes(cb.value)) cb.checked = true;
    else if (cb.value === '鍼通電' && r.txs.some(t => esText(t.id))) cb.checked = true;
  });
  saveForm();
}

async function init() {
  try {
    const [karte, tcm, stim, tmech, tmaster, electro] = await Promise.all([
      fetch('data/karte_schema.json').then(r => r.json()),
      fetch('data/tcm_findings.json').then(r => r.json()),
      fetch('data/stimulus_modulation.json').then(r => r.json()).catch(() => null),
      fetch('data/track_to_mechanism.json').then(r => r.json()).catch(() => null),
      fetch('data/treatment_master.json').then(r => r.json()).catch(() => null),
      fetch('data/electrotherapy_params.json').then(r => r.json()).catch(() => null)
    ]);
    STIM_MOD = stim;
    TRACK_MECH = tmech;
    TREATMENTS = tmaster && tmaster[0] ? tmaster[0].treatments : null;
    ELECTRO = electro;

    const order = Object.keys(karte).filter(k => !META.has(k) && typeof karte[k] === 'object');
    let html = buildControls();
    for (const k of order) {
      html += renderSection(k, karte[k], 0, '');
      if (k === 'stimulus_decision') html += renderTcm(tcm);
    }
    html += `<div class="actions">
      <button class="btn" onclick="window.print()">🖨 印刷</button>
      <button class="btn" id="k-clear">🗑 入力をクリア</button>
      <a class="btn" href="index.html">← 鑑別へ戻る</a>
    </div>`;
    app().innerHTML = html;

    refreshRecordList();
    restoreForm();
    const filled = prefillFromEngine();
    updateAge();
    updateStimulus();
    buildTreatmentSuggest();

    // 自動保存（下書き）＋年齢/刺激サジェスト再計算
    const onChange = (e) => {
      const dp = e.target && e.target.dataset ? e.target.dataset.path : '';
      if (dp && dp.startsWith('profile.birth_')) updateAge();
      if (dp && dp.startsWith('tcm.')) updateStimulus();
      saveForm();
    };
    app().addEventListener('input', onChange);
    app().addEventListener('change', onChange);

    // 保存
    document.getElementById('rec-save').addEventListener('click', () => {
      const recs = loadRecords();
      const id = Date.now().toString();
      const nameInput = document.getElementById('rec-name').value.trim();
      const profName = (document.querySelector('[data-path="profile.name"]') || {}).value || '';
      const name = nameInput || profName || ('カルテ' + (Object.keys(recs).length + 1));
      recs[id] = { name, at: new Date().toLocaleString('ja-JP'), data: serializeForm() };
      storeRecords(recs);
      refreshRecordList();
      document.getElementById('rec-list').value = id;
      alert(`「${name}」を保存しました。`);
    });
    // 呼び出し
    document.getElementById('rec-load').addEventListener('click', () => {
      const id = document.getElementById('rec-list').value;
      if (!id) { alert('呼び出すカルテを選択してください。'); return; }
      const recs = loadRecords();
      if (!recs[id]) return;
      applyData(recs[id].data);
      saveForm();
      alert(`「${recs[id].name}」を呼び出しました。`);
    });
    // 削除
    document.getElementById('rec-del').addEventListener('click', () => {
      const id = document.getElementById('rec-list').value;
      if (!id) { alert('削除するカルテを選択してください。'); return; }
      const recs = loadRecords();
      if (!recs[id]) return;
      if (!confirm(`「${recs[id].name}」を削除しますか？`)) return;
      delete recs[id];
      storeRecords(recs);
      refreshRecordList();
    });
    // 書き出し（現在の下書き＋保存済み全件＋直近エンジン出力をJSONで保存）
    document.getElementById('rec-export').addEventListener('click', () => {
      let eng = null; try { eng = JSON.parse(localStorage.getItem('karte_engine_output') || 'null'); } catch (e) {}
      const bundle = { schema: 'karte_export', version: 1, exported_at: new Date().toISOString(), form: serializeForm(), records: loadRecords(), engine_output: eng };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `karte_${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    });
    // 読み込み
    document.getElementById('rec-import').addEventListener('click', () => document.getElementById('rec-file').click());
    document.getElementById('rec-file').addEventListener('change', (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const b = JSON.parse(reader.result);
          if (b.records) { const cur = loadRecords(); storeRecords(Object.assign(cur, b.records)); refreshRecordList(); }
          if (b.engine_output) localStorage.setItem('karte_engine_output', JSON.stringify(b.engine_output));
          if (b.form) { applyData(b.form); saveForm(); }
          alert('読み込みました（保存済みカルテはマージ）。');
        } catch (err) { alert('読み込みに失敗しました：' + err.message); }
        e.target.value = '';
      };
      reader.readAsText(file);
    });

    // 下書きクリア
    document.getElementById('k-clear').addEventListener('click', () => {
      if (!confirm('現在の入力内容をクリアしますか？（保存済みカルテは残ります）')) return;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      location.reload();
    });

    if (filled) {
      const banner = document.createElement('div');
      banner.className = 'card';
      banner.innerHTML = `<p class="lead">🗂 直近の鑑別結果（${filled.saved_at || ''}）を「鑑別エンジン出力」「診断名」に自動入力しました。</p>`;
      app().prepend(banner);
    }
  } catch (e) {
    app().innerHTML = `<div class="card error">カルテ様式の読み込みに失敗しました：${e.message}</div>`;
  }
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
