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
const BACKUP_META_KEY = 'karte_backup_meta'; // 最終書き出し記録 {at, count}
// 舌・脈・抗重力筋の所見。mos.html（東洋弁証の証候候補スコアリング）と同一キーを共有する単一ソース。
// 別々に持つと同じ所見を二重入力し、東西の判断が食い違う（証は虚証なのに刺激量は強め等）ため一本化する。
const TCM_SHARED_KEY = 'tcm_shared_findings';
function getTcmShared() { try { return JSON.parse(localStorage.getItem(TCM_SHARED_KEY) || '{}'); } catch (e) { return {}; } }
function setTcmShared(o) { try { localStorage.setItem(TCM_SHARED_KEY, JSON.stringify(o)); } catch (e) {} }
// 共有キー → カルテの舌脈入力欄（表示側）。preferShared=true で共有側の値を優先（他タブ編集・カルテ呼び出し直後に使用）。
function syncTcmFieldsFromShared(preferShared) {
  const shared = getTcmShared();
  const map = [['tcm.pulse.strength', 'strength'], ['tcm.tongue.color', 'tongue_color'], ['tcm.tongue.shape', 'tongue_shape'], ['tcm.muscle_hardness.value', 'muscle_hardness']];
  map.forEach(([dp, key]) => {
    const el = document.querySelector(`[data-path="${dp}"]`);
    if (!el) return;
    if (shared[key] != null && (preferShared || !el.value)) el.value = shared[key];
  });
}
// カルテの舌脈入力欄（表示側） → 共有キー。値がある項目のみ反映（空欄で他タブの値を消さない）。
function pushTcmToShared() {
  const shared = getTcmShared();
  const v = dp => (document.querySelector(`[data-path="${dp}"]`) || {}).value || '';
  const pulse = v('tcm.pulse.strength'), tColor = v('tcm.tongue.color'), tShape = v('tcm.tongue.shape'), hard = v('tcm.muscle_hardness.value');
  if (pulse) shared.strength = pulse;
  if (tColor) shared.tongue_color = tColor;
  if (tShape) shared.tongue_shape = tShape;
  if (hard) shared.muscle_hardness = hard;
  setTcmShared(shared);
}
let STIM_MOD = null;                      // stimulus_modulation（刺激量サジェスト）
let TRACK_MECH = null, TREATMENTS = null, ELECTRO = null; // 治療プラン自動提案用
let PATIENT_SCRIPTS = null; // 患者向け説明スクリプト
let MECH_ENUM = null;        // カルテ機序欄の選択肢（_enum_mechanism）

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 経過記録（その日の症状）カード。エントリは hidden(data-path=progress_log) にJSONで保持し保存/書き出しに含む
function buildProgressCard() {
  return `<section class="card k-section" id="progress-card">
    <h2>経過記録（その日の症状）</h2>
    <div class="k-field"><span class="k-label">日付</span><input type="date" id="pl-date"></div>
    <div class="k-field"><span class="k-label">本日の症状・所見</span><textarea id="pl-text" rows="3" placeholder="例：右肩の夜間痛が軽減。挙上◯◯度まで改善…"></textarea></div>
    <div class="actions" style="margin-top:.4rem"><button class="btn primary" id="pl-add">＋ 記録を追加</button></div>
    <input type="hidden" data-path="progress_log" id="pl-store">
    <div id="pl-list"></div>
  </section>`;
}

function getProgressEntries() {
  const store = document.getElementById('pl-store');
  if (!store) return [];
  try { return JSON.parse(store.value || '[]'); } catch (e) { return []; }
}
function renderProgressLog() {
  const list = document.getElementById('pl-list');
  if (!list) return;
  const arr = getProgressEntries();
  list.innerHTML = arr.length ? arr.map((e, i) =>
    `<div class="pl-entry"><div class="pl-meta">${escapeHtml(e.date || '')}</div>
     <div class="pl-body">${escapeHtml(e.text || '').replace(/\n/g, '<br>')}</div>
     <button class="btn pl-del" data-i="${i}">削除</button></div>`).join('')
    : '<p class="hint">まだ記録がありません。</p>';
  list.querySelectorAll('.pl-del').forEach(b => b.addEventListener('click', () => {
    const arr2 = getProgressEntries();
    arr2.splice(Number(b.dataset.i), 1);
    document.getElementById('pl-store').value = JSON.stringify(arr2);
    saveForm(); renderProgressLog();
  }));
}

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
  const phaseField = `<div class="k-field"><span class="k-label">時期（phase）</span>
    <input type="text" data-path="stimulus_decision.phase" placeholder="脈・舌から自動推定"></div>`;
  return `<section class="card k-section"><h2>東洋医学的所見（刺激量の決定）</h2>
    <p class="lead">脈・舌・抗重力筋の硬さ → 時期(phase)と刺激量の参考。術者が記入。東洋弁証（MOS）ページと共有される項目です。</p>${blocks}${phaseField}
    <div id="stim-suggest" class="obs-block" hidden></div></section>`;
}

// 脈・舌・硬さ → 時期(phase)＋刺激サジェストを算出する純粋関数（DOM非依存）。
// 共有キー(tcm_shared_findings)を読むため、MOSページで入力した舌脈もそのまま反映される。
function computeStimulusSuggestion() {
  const shared = getTcmShared();
  const pulse = shared.strength || '';
  const tColor = shared.tongue_color || '';
  const tShape = shared.tongue_shape || '';
  const hard = shared.muscle_hardness || '';
  if (!pulse && !tColor && !tShape && !hard) return null;

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

  // 脈からみた刺激強度（補瀉整合チェックで使用）。弱い脈=弱刺激が原則、強い/正常=強刺激も可。
  const strengthLevel = pulseWeak ? 'weak' : (pulse ? 'strong' : 'neutral');
  return { phase, lines, pulseWeak, strengthLevel };
}

// 脈・舌・硬さ → 時期(phase)＋刺激サジェスト（stimulus_modulation, 臨床経験ベース）をDOMへ反映
function updateStimulus() {
  const box = document.getElementById('stim-suggest');
  if (box && STIM_MOD) {
    const sug = computeStimulusSuggestion();
    if (!sug) {
      box.hidden = true;
    } else {
      const phaseEl = document.querySelector('[data-path="stimulus_decision.phase"]');
      if (phaseEl && sug.phase) phaseEl.value = sug.phase;
      box.hidden = false;
      box.innerHTML = `<p class="obs-h">🧭 刺激量サジェスト（脈・舌・硬さより／臨床経験ベース）</p>
        ${sug.phase ? `<p>推定時期（phase）：<b>${sug.phase}</b>${sug.pulseWeak ? '（脈が弱い→急性/慢性に優先して弱刺激・浅め）' : ''}</p>` : ''}
        <ul class="hit-list">${sug.lines.map(l => `<li>${l}</li>`).join('')}</ul>
        <p class="hint">エビデンスではなく臨床経験に基づく参考（原著明記）。Step3鑑別とは別格。</p>`;
    }
  }
  buildIntegratedPlanCard();
}

// 証のtechnique文字列 → 補瀉分類。「補」「瀉」両方含む(初期は瀉法、後期は平補平瀉 等)は mixed、
// どちらも含まない(虚実で異なる 等)は null として整合チェックの対象外にする。
function bianzhengPolarity(techniqueText) {
  const t = techniqueText || '';
  const hasBu = t.includes('補'), hasXie = t.includes('瀉');
  if (hasBu && hasXie) return 'mixed';
  if (hasBu) return 'tonify';
  if (hasXie) return 'purge';
  return null;
}

// 証の補瀉 と 刺激強度(脈由来 or 西洋機序の手技) の不整合を検出。
// 虚証(補法)への強刺激は「虚虚の戒め」に反するため主眼に置き、実証(瀉法)+弱刺激は参考情報として扱う。
function checkStimConsistency(bzPolarity, stimStrengthLevel, westernTechniques) {
  if (!bzPolarity || bzPolarity === 'mixed') return null;
  const techs = westernTechniques || [];
  const westernStrong = techs.some(t => /雀啄|響く|鍼通電|深部組織/.test(t));
  const westernWeak = techs.length > 0 && techs.every(t => /軽微|置鍼|鍉鍼|接触鍼|擦過/.test(t));

  if (bzPolarity === 'tonify' && (stimStrengthLevel === 'strong' || westernStrong)) {
    return { level: 'warn', message: '証は補法（虚証）ですが、選択中の刺激は強め（瀉法寄り）です。虚証への強刺激は避け、刺激量・手技を弱める方向で再検討してください。' };
  }
  if (bzPolarity === 'purge' && (stimStrengthLevel === 'weak' || westernWeak)) {
    return { level: 'info', message: '証は瀉法（実証）ですが、選択中の刺激は弱め（補法寄り）です。効果が乏しい可能性があるため、刺激量を強める余地がないか確認してください。' };
  }
  return null;
}

// 西洋（機序）× 東洋（証・補瀉）× 刺激量 を1枚に合成した統合治療方針カード。
// これまで3箇所に分散していた示唆を一覧化し、補瀉と刺激量の不整合があれば警告する。
function buildIntegratedPlanCard() {
  const existing = document.getElementById('integrated-plan-card');
  if (existing) existing.remove();

  let eng = null; try { eng = JSON.parse(localStorage.getItem('karte_engine_output') || 'null'); } catch (e) {}
  let bz = null; try { bz = JSON.parse(localStorage.getItem('mos_bianzheng_result') || 'null'); } catch (e) {}
  const stimSug = computeStimulusSuggestion();
  if (!eng && !bz && !stimSug) return;

  const r = (eng && eng.treatment_track) ? resolveTx(eng.treatment_track, eng.region_key) : null;
  const westernTechniques = ((r && r.txs) || []).map(t => t.technique);

  const westernHtml = eng && eng.treatment_track
    ? `<div class="k-field"><span class="k-label">西洋（機序）</span><div>${escapeHtml(eng.treatment_track)}${r && r.txs.length ? ' — ' + r.txs.map(t => escapeHtml(t.mechanism)).join('・') : '（鍼の機序候補なし）'}</div></div>`
    : '';
  const easternHtml = bz
    ? `<div class="k-field"><span class="k-label">東洋（証）</span><div><b>${escapeHtml(bz.syndrome)}</b>（${escapeHtml(bz.group || '')}） — ${escapeHtml(bz.technique || '')}</div></div>`
    : '';
  const stimHtml = stimSug
    ? `<div class="k-field"><span class="k-label">刺激量</span><div>${stimSug.phase ? `時期：${escapeHtml(stimSug.phase)}　` : ''}${stimSug.lines.map(escapeHtml).join(' / ')}</div></div>`
    : '';
  if (!westernHtml && !easternHtml && !stimHtml) return;

  const bzPolarity = bz ? bianzhengPolarity(bz.technique) : null;
  const warn = checkStimConsistency(bzPolarity, stimSug && stimSug.strengthLevel, westernTechniques);
  const warnHtml = !warn ? '' : warn.level === 'warn'
    ? `<div class="alert yellow"><strong>⚠ 補瀉と刺激量の不整合</strong><p>${escapeHtml(warn.message)}</p></div>`
    : `<div class="obs-block"><p class="obs-h">ℹ 補瀉について</p><p>${escapeHtml(warn.message)}</p></div>`;

  const card = document.createElement('section');
  card.className = 'card';
  card.id = 'integrated-plan-card';
  card.innerHTML = `<h2>統合治療方針（西洋 × 東洋 × 刺激量）</h2>
    <p class="hint">3つの示唆を合成した一覧です（確定ではなく参考）。最終判断は術者が行ってください。</p>
    ${westernHtml}${easternHtml}${stimHtml}${warnHtml}`;

  const directActions = [...app().children].filter(el => el.classList && el.classList.contains('actions'));
  const anchor = directActions[directActions.length - 1];
  if (anchor) app().insertBefore(card, anchor); else app().appendChild(card);
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
  renderProgressLog();
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
  // cause_tissue: engine_output に無ければ問診の予想組織(step2 チェック済み)で補完。
  // restoreForm() 後に呼ばれるため step2 のチェック状態を参照できる。
  let causeTissue = data.cause_tissue;
  if (causeTissue == null || causeTissue === '' || (Array.isArray(causeTissue) && !causeTissue.length)) {
    const picked = [...document.querySelectorAll('[data-path="step2_tissue_prediction.predicted_tissue"]:checked')].map(e => e.value);
    if (picked.length) causeTissue = picked;
  }
  set(`${base}.cause_tissue`, causeTissue);
  set(`${base}.treatment_track`, data.treatment_track);
  set('profile.diagnosis_name', data.confirmed_disease, true);
  // 鑑別の陽性所見を「部位と痛みの性状」へ転記（空のときのみ）
  if (data.positive_findings && data.positive_findings.length) {
    set('step3_disease.pain_location_and_state',
      `${data.region || ''}（${data.branch || ''}）｜陽性所見：${data.positive_findings.join('、')}`, true);
  }
  // 鑑別の徒手検査(陽性/陰性)を「疾患を把握する」の各検査欄へキーワード振り分け（空欄のみ）
  // 順序が優先度：病的反射→腱反射 のように先に来た route を採用。
  const EXAM_ROUTES = [
    { kw: ['病的反射', 'ホフマン', 'トレムナー', 'ワルテンベルグ'], path: 'step3_disease.exam_physical.pathological_reflex' },
    { kw: ['バレー'], path: 'step3_disease.exam_physical.balre_sign' },
    { kw: ['回内', '回外'], path: 'step3_disease.exam_physical.pronation_supination' },
    { kw: ['反射'], path: 'step3_disease.exam_spinal.reflex' },
    { kw: ['筋力'], path: 'step3_disease.exam_spinal.muscle_strength' },
    { kw: ['感覚', '知覚', 'しびれ', 'デルマトーム'], path: 'step3_disease.exam_spinal.sensory' },
    { kw: ['叩打'], path: 'step3_disease.exam_bone.percussion_pain' },
    { kw: ['熱感'], path: 'step3_disease.exam_joint.heat' },
    { kw: ['腫脹', '腫れ', '浮腫'], path: 'step3_disease.exam_joint.swelling' },
    { kw: ['発赤'], path: 'step3_disease.exam_joint.redness' },
    { kw: ['可動域', 'ROM', '屈曲', '伸展', '外転', '開口', '背屈', '底屈', '前屈', '後屈'], path: 'step3_disease.exam_joint.rom_test' },
    { kw: ['圧痛', '硬結', 'トリガー'], path: 'step3_disease.exam_muscle.tenderness' }
  ];
  if (data.findings_detail && data.findings_detail.length) {
    const acc = {};
    data.findings_detail.forEach(f => {
      const r = EXAM_ROUTES.find(r => r.kw.some(k => f.sign.includes(k)));
      if (!r) return;
      (acc[r.path] = acc[r.path] || []).push(`${f.sign}（${f.ans === 'pos' ? '陽性' : '陰性'}）`);
    });
    Object.keys(acc).forEach(p => set(p, acc[p].join(' / '), true));
  }
  return data;
}

// ---- 複数カルテの保存／呼び出し ----
function loadRecords() { try { return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}'); } catch (e) { return {}; } }
function storeRecords(r) { try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); } catch (e) {} }
// ---- バックアップ（書き出し）状況の記録・注意喚起 ----
// localStorageのみが正でブラウザ削除/端末変更で消失し得るため、未書き出し件数・経過日数から促す。
function getBackupMeta() { try { return JSON.parse(localStorage.getItem(BACKUP_META_KEY) || 'null'); } catch (e) { return null; } }
function setBackupMeta(count) { try { localStorage.setItem(BACKUP_META_KEY, JSON.stringify({ at: new Date().toISOString(), count })); } catch (e) {} }

// localStorage 使用量の概算（UTF-16換算バイト）。ブラウザの一般的な上限(目安5MB)からの逼迫度を出す。
function estimateStorageBytes() {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      total += (k.length + (localStorage.getItem(k) || '').length) * 2;
    }
  } catch (e) {}
  return total;
}

function buildBackupReminder() {
  const existing = document.getElementById('backup-reminder-card');
  if (existing) existing.remove();

  const recCount = Object.keys(loadRecords()).length;
  const meta = getBackupMeta();
  const pending = meta ? Math.max(0, recCount - meta.count) : recCount;
  const daysSince = meta ? (Date.now() - new Date(meta.at).getTime()) / 86400000 : Infinity;

  const bytes = estimateStorageBytes();
  const quotaWarn = bytes > 4 * 1024 * 1024; // 目安5MBの8割超で警告

  const shouldNag = recCount > 0 && (pending >= 3 || (pending > 0 && daysSince >= 7) || (!meta && recCount > 0));
  if (!shouldNag && !quotaWarn) return;

  const lastTxt = meta ? new Date(meta.at).toLocaleString('ja-JP') : '未実施';
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'backup-reminder-card';
  card.innerHTML = `<p class="lead">📦 データはこの端末のブラウザ内にのみ保存されています。定期的な書き出し(JSON)を推奨します。</p>
    ${shouldNag ? `<p class="hint">最終書き出し：${lastTxt}${pending > 0 ? `／未書き出しのカルテ ${pending} 件` : ''}</p>` : ''}
    ${quotaWarn ? `<div class="alert yellow"><strong>⚠ 保存容量が多くなっています</strong><p>ブラウザのデータ削除で失われる前に書き出しをおすすめします（目安使用量 ${(bytes / 1024 / 1024).toFixed(1)}MB）。</p></div>` : ''}
    <div class="actions"><button class="btn primary" id="backup-now">⬇ 今すぐ書き出す</button><button class="btn" id="backup-later">あとで</button></div>`;
  app().prepend(card);

  document.getElementById('backup-now').addEventListener('click', () => document.getElementById('rec-export').click());
  document.getElementById('backup-later').addEventListener('click', () => card.remove());
}

let ACTIVE_KANA_ROW = ''; // '' = すべて
function refreshRecordList() {
  const sel = document.getElementById('rec-list');
  if (!sel) return;
  const recs = loadRecords();
  // よみ（無ければ名前）の五十音順 → 同行内は保存日時降順
  let ids = Object.keys(recs).sort((a, b) => {
    const ra = kanaRowOf(recs[a].yomi || recs[a].name) || '';
    const rb = kanaRowOf(recs[b].yomi || recs[b].name) || '';
    if (ra !== rb) return ra.localeCompare(rb, 'ja');
    return Number(b) - Number(a);
  });
  if (ACTIVE_KANA_ROW) ids = ids.filter(id => kanaRowOf(recs[id].yomi || recs[id].name) === ACTIVE_KANA_ROW);

  if (!ids.length) {
    sel.innerHTML = `<option value="">（${ACTIVE_KANA_ROW ? ACTIVE_KANA_ROW + '行に' : ''}該当するカルテがありません）</option>`;
    return;
  }
  let html = '';
  let lastRow = null;
  ids.forEach(id => {
    const row = kanaRowOf(recs[id].yomi || recs[id].name) || '？';
    if (row !== lastRow) { html += `<option value="" disabled>─ ${row}行 ─</option>`; lastRow = row; }
    html += `<option value="${id}">${recs[id].name}（${recs[id].at}）</option>`;
  });
  sel.innerHTML = html;
}

// 五十音の行インデックス（濁音・半濁音・小書きは清音の行に丸める）
const KANA_ROWS = [
  { row: 'あ', chars: 'あいうえおぁぃぅぇぉ' },
  { row: 'か', chars: 'かきくけこがぎぐげご' },
  { row: 'さ', chars: 'さしすせそざじずぜぞ' },
  { row: 'た', chars: 'たちつてとだぢづでどっ' },
  { row: 'な', chars: 'なにぬねの' },
  { row: 'は', chars: 'はひふへほばびぶべぼぱぴぷぺぽ' },
  { row: 'ま', chars: 'まみむめも' },
  { row: 'や', chars: 'やゆよゃゅょ' },
  { row: 'ら', chars: 'らりるれろ' },
  { row: 'わ', chars: 'わをんゎ' }
];
// カタカナ→ひらがな正規化（濁点・半濁点はUnicode正規化で分解される場合があるため簡易マップ）
function toHiragana(s) {
  return String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
// よみ（ひらがな/カタカナ）先頭文字 → 五十音の行
function kanaRowOf(yomi) {
  const h = toHiragana(yomi).trim();
  if (!h) return null;
  const c = h[0];
  const hit = KANA_ROWS.find(r => r.chars.includes(c));
  return hit ? hit.row : null;
}

function buildControls() {
  const rowChips = KANA_ROWS.map(r => `<button type="button" class="btn kana-chip" data-row="${r.row}">${r.row}</button>`).join('');
  return `<section class="card">
    <h2>カルテ保存 / 呼び出し</h2>
    <div class="k-field"><span class="k-label">保存名（氏名など）</span><input id="rec-name" type="text" placeholder="氏名・日付など（空なら自動）"></div>
    <div class="k-field"><span class="k-label">よみ（ひらがな・五十音検索用）</span><input id="rec-yomi" type="text" placeholder="例：やまだたろう"></div>
    <div class="actions" style="margin-top:.4rem"><button class="btn primary" id="rec-save">💾 現在の内容を保存</button></div>
    <div class="k-field" style="margin-top:.6rem"><span class="k-label">五十音で絞り込み</span>
      <div class="kana-chips">
        <button type="button" class="btn kana-chip on" data-row="">すべて</button>
        ${rowChips}
      </div>
    </div>
    <div class="k-field"><span class="k-label">保存済みカルテ</span><select id="rec-list" size="6"></select></div>
    <div class="actions"><button class="btn" id="rec-load">📂 呼び出し</button><button class="btn" id="rec-del">🗑 選択を削除</button></div>
    <div class="actions" style="margin-top:.4rem">
      <button class="btn" id="rec-export">⬇ 書き出し(JSON)</button>
      <button class="btn" id="rec-import">⬆ 読み込み(JSON)</button>
      <input type="file" id="rec-file" accept="application/json,.json" hidden>
    </div>
  </section>`;
}

// 正準トラック→治療マスタ（鑑別エンジン側 TRACK_MAP と同等。記述的トラックが無い既存14部位用フォールバック）
const KARTE_TRACK_MAP = {
  '局所筋骨格': t => t.level === '末梢',
  '神経系': t => t.level === '末梢' || t.level === '脊髄' || t.id === 'descending_inhibition',
  '心理社会的': t => t.level === '脳',
  '自律神経': t => t.id === 'somato_autonomic_reflex' || t.id === 'autonomic_regulation' || t.id === 'descending_inhibition'
};

// ---- 治療プラン自動提案（resolver: track_to_mechanism + electrotherapy_params） ----
function resolveTx(track, regionKey) {
  if (!TRACK_MECH || !TREATMENTS || !track) return null;
  const m = TRACK_MECH.mappings.find(x => x.track === track);
  if (!m) {
    // 記述的トラックに無い＝正準トラック。TRACK_MAP相当でフォールバック
    const rule = KARTE_TRACK_MAP[track];
    if (!rule) return null;
    return { txs: TREATMENTS.filter(rule), primary: new Set(), reason: '' };
  }
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

  // 治療部位（局所/遠隔）を第一選択機序の stimulus_site から自動選択（空のときのみ）
  const locEl = document.querySelector('[data-path="treatment_plan.treatment_location"]');
  if (locEl && !locEl.value && r.txs[0]) {
    const SITE_MAP = { '痛みがあるところ': '局所', '遠隔部・同一分節': '遠隔(分節)', '遠隔部・異分節': '遠隔(四肢)' };
    const loc = SITE_MAP[r.txs[0].stimulus_site];
    if (loc && [...locEl.options].some(o => o.value === loc)) locEl.value = loc;
  }

  // 機序欄（治療プラン）に、確定疾患(1位)で使う機序を自動チェック
  if (MECH_ENUM) {
    // treatment_master の機序id → カルテ機序選択肢のindex
    const MAP = {
      opioid_receptor: 0, adenosine_a1: 0, gate_control_local: 1, gate_control_segment: 1,
      descending_inhibition: 2, ia_ib_inhibition: 3, somato_autonomic_reflex: 4,
      autonomic_regulation: 4, blood_flow: 5, keratinocyte_immune: 6, neurotransmitter: 7
    };
    const wanted = new Set(r.txs.map(t => MECH_ENUM[MAP[t.id]]).filter(Boolean));
    document.querySelectorAll('[data-path="treatment_plan.mechanism"]').forEach(cb => {
      if (wanted.has(cb.value)) cb.checked = true;
    });
  }
  saveForm();
}

// 確定疾患IDから患者向け説明スクリプトを表示（病期進行型は病期セレクト付き）
function buildPatientScript() {
  if (!PATIENT_SCRIPTS) return;
  let data; try { data = JSON.parse(localStorage.getItem('karte_engine_output') || 'null'); } catch (e) {}
  const id = data && data.confirmed_disease_id;
  if (!id) return;

  const phase = (PATIENT_SCRIPTS.phase_progression_scripts || []).find(s => s.disease_id === id);
  const chronic = (PATIENT_SCRIPTS.chronic_management_scripts || []).find(s => s.disease_id === id);
  if (!phase && !chronic) return;

  const card = document.createElement('section');
  card.className = 'card';
  if (phase) {
    const opts = phase.phases.slice().sort((a, b) => a.order - b.order)
      .map(p => `<option value="${p.phase}">${p.phase}</option>`).join('');
    card.innerHTML = `<h2>患者向け説明（${phase.disease_name}）</h2>
      <p class="lead">経過：${phase.overall_duration}。病期を選ぶと説明文が出ます。</p>
      <div class="k-field"><span class="k-label">現在の病期</span><select id="ps-phase">${opts}</select></div>
      <div id="ps-text" class="obs-block"></div>
      <p class="hint">${phase.treatment_role}</p>`;
  } else {
    card.innerHTML = `<h2>患者向け説明（${chronic.disease_name}）</h2>
      <div class="obs-block"><p>${chronic.script}</p></div>
      ${chronic.referral_note ? `<p class="hint">⚠ ${chronic.referral_note}</p>` : ''}`;
  }

  // 直下の最終 .actions（印刷バー）の前に挿入（入れ子の保存ボタン群を避ける）
  const directActions = [...app().children].filter(el => el.classList && el.classList.contains('actions'));
  const anchor = directActions[directActions.length - 1];
  if (anchor) app().insertBefore(card, anchor); else app().appendChild(card);

  if (phase) {
    const sel = document.getElementById('ps-phase');
    const txt = document.getElementById('ps-text');
    const draw = () => {
      const p = phase.phases.find(x => x.phase === sel.value);
      txt.innerHTML = p ? `<p>${p.script}</p>` : '';
    };
    sel.addEventListener('change', draw);
    draw();
  }
}

// MOSの生回答・弁証グループ選択・相違点チェック・舌脈所見。カルテ保存/書き出しに含め監査可能にする（確定証サマリだけでは根拠が消えるため）
const MOS_RAW_KEYS = ['mos_answers', 'mos_distinct_checks', 'mos_scale_mode', TCM_SHARED_KEY, 'mos_selected_syndrome'];
function captureMosRaw() {
  const out = {};
  MOS_RAW_KEYS.forEach(k => { try { const v = localStorage.getItem(k); if (v != null) out[k] = v; } catch (e) {} });
  return out;
}
function restoreMosRaw(obj) {
  MOS_RAW_KEYS.forEach(k => {
    try { (obj && obj[k] != null) ? localStorage.setItem(k, obj[k]) : localStorage.removeItem(k); } catch (e) {}
  });
}

// MOS弁証の確定証（mos_bianzheng_result）をカルテに流し込み（証・選穴・手技・根拠の表示カード）
function buildBianzhengCard() {
  const existing = document.getElementById('bz-karte-card');
  if (existing) existing.remove();
  let data; try { data = JSON.parse(localStorage.getItem('mos_bianzheng_result') || 'null'); } catch (e) {}
  if (!data || !data.syndrome) return;

  const pts = (data.points_detail && data.points_detail.length)
    ? data.points_detail
    : (data.points || []).map(n => ({ name: n }));
  const ptHtml = pts.map(p =>
    `<span class="bz-point">${escapeHtml(p.name)}${p.code && p.code !== '—' ? `<small>${escapeHtml(p.code)}</small>` : ''}</span>`).join('');

  const card = document.createElement('section');
  card.className = 'card';
  card.id = 'bz-karte-card';
  card.innerHTML = `<h2>東洋医学的弁証（MOS）</h2>
    <p class="hint">MOSスコア→証候候補から選択した証（確定証ではなく示唆）。${data.saved_at ? escapeHtml(data.saved_at) : ''}</p>
    <div class="k-field"><span class="k-label">証</span><div><b>${escapeHtml(data.syndrome)}</b> <span class="tag light">${escapeHtml(data.group || '')}</span></div></div>
    ${data.matched_distinct && data.matched_distinct.length ? `<div class="k-field"><span class="k-label">該当した相違点</span><div>${data.matched_distinct.map(escapeHtml).join('・')}</div></div>` : ''}
    ${data.tongue_pulse_matched && data.tongue_pulse_matched.length ? `<div class="k-field"><span class="k-label">舌脈所見との一致</span><div>${data.tongue_pulse_matched.map(escapeHtml).join('・')}</div></div>` : ''}
    <div class="bz-points" style="margin:.5rem 0"><b>選穴例</b> ${ptHtml}</div>
    <div class="k-field"><span class="k-label">手技</span><div>${escapeHtml(data.technique || '')}</div></div>`;

  // 直下の最終 .actions（印刷バー）の前に挿入（buildPatientScript と同型）
  const directActions = [...app().children].filter(el => el.classList && el.classList.contains('actions'));
  const anchor = directActions[directActions.length - 1];
  if (anchor) app().insertBefore(card, anchor); else app().appendChild(card);
}

async function init() {
  try {
    const [karte, tcm, stim, tmech, tmaster, electro, pscripts] = await Promise.all([
      fetch('data/karte_schema.json').then(r => r.json()),
      fetch('data/tcm_findings.json').then(r => r.json()),
      fetch('data/stimulus_modulation.json').then(r => r.json()).catch(() => null),
      fetch('data/track_to_mechanism.json').then(r => r.json()).catch(() => null),
      fetch('data/treatment_master.json').then(r => r.json()).catch(() => null),
      fetch('data/electrotherapy_params.json').then(r => r.json()).catch(() => null),
      fetch('data/patient_scripts.json').then(r => r.json()).catch(() => null)
    ]);
    STIM_MOD = stim;
    TRACK_MECH = tmech;
    TREATMENTS = tmaster && tmaster[0] ? tmaster[0].treatments : null;
    ELECTRO = electro;
    PATIENT_SCRIPTS = pscripts;
    MECH_ENUM = (karte.treatment_plan && karte.treatment_plan._enum_mechanism) || null;

    const order = Object.keys(karte).filter(k => !META.has(k) && typeof karte[k] === 'object');
    let html = buildControls();
    for (const k of order) {
      // 「刺激量の決定」は東洋医学的所見に統合（脈・舌・硬さ＋phase＋サジェスト）
      if (k === 'stimulus_decision') { html += renderTcm(tcm); continue; }
      html += renderSection(k, karte[k], 0, '');
    }
    html += buildProgressCard();
    html += `<div class="actions">
      <button class="btn" onclick="window.print()">🖨 印刷</button>
      <button class="btn" id="k-clear">🗑 入力をクリア</button>
      <a class="btn" href="index.html">← 鑑別へ戻る</a>
    </div>`;
    app().innerHTML = html;

    refreshRecordList();
    restoreForm();
    // 舌脈所見の共有キーと突き合わせ：空欄は共有側で補完、値があれば共有側へ反映（相互同期の起点）
    syncTcmFieldsFromShared(false);
    pushTcmToShared();
    const filled = prefillFromEngine();
    updateAge();
    updateStimulus(); // 内部で buildIntegratedPlanCard() も実行
    buildTreatmentSuggest();
    buildPatientScript();
    buildBianzhengCard();
    buildIntegratedPlanCard();

    // 経過記録：日付デフォルト＝本日、追加ボタン、一覧描画
    const plDate = document.getElementById('pl-date');
    if (plDate && !plDate.value) plDate.value = new Date().toISOString().slice(0, 10);
    renderProgressLog();
    const plAdd = document.getElementById('pl-add');
    if (plAdd) plAdd.addEventListener('click', () => {
      const d = (document.getElementById('pl-date').value) || new Date().toISOString().slice(0, 10);
      const t = document.getElementById('pl-text').value.trim();
      if (!t) { alert('本日の症状を入力してください。'); return; }
      const arr = getProgressEntries();
      arr.unshift({ date: d, text: t });
      document.getElementById('pl-store').value = JSON.stringify(arr);
      document.getElementById('pl-text').value = '';
      saveForm(); renderProgressLog();
    });

    // 自動保存（下書き）＋年齢/刺激サジェスト再計算
    const onChange = (e) => {
      const dp = e.target && e.target.dataset ? e.target.dataset.path : '';
      if (dp && dp.startsWith('profile.birth_')) updateAge();
      if (dp && dp.startsWith('tcm.')) { pushTcmToShared(); updateStimulus(); }
      saveForm();
    };
    app().addEventListener('input', onChange);
    app().addEventListener('change', onChange);

    // 五十音チップで絞り込み
    document.querySelectorAll('.kana-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        ACTIVE_KANA_ROW = chip.dataset.row;
        document.querySelectorAll('.kana-chip').forEach(c => c.classList.toggle('on', c === chip));
        refreshRecordList();
      });
    });

    // 保存
    document.getElementById('rec-save').addEventListener('click', () => {
      const recs = loadRecords();
      const id = Date.now().toString();
      const nameInput = document.getElementById('rec-name').value.trim();
      const profName = (document.querySelector('[data-path="profile.name"]') || {}).value || '';
      const name = nameInput || profName || ('カルテ' + (Object.keys(recs).length + 1));
      const yomi = document.getElementById('rec-yomi').value.trim();
      let bz = null; try { bz = localStorage.getItem('mos_bianzheng_result'); } catch (e) {}
      recs[id] = { name, yomi, at: new Date().toLocaleString('ja-JP'), data: serializeForm(), bianzheng: bz, mos_raw: captureMosRaw() };
      storeRecords(recs);
      refreshRecordList();
      document.getElementById('rec-list').value = id;
      buildBackupReminder();
      alert(`「${name}」を保存しました。`);
    });
    // 呼び出し
    document.getElementById('rec-load').addEventListener('click', () => {
      const id = document.getElementById('rec-list').value;
      if (!id) { alert('呼び出すカルテを選択してください。'); return; }
      const recs = loadRecords();
      if (!recs[id]) return;
      applyData(recs[id].data);
      document.getElementById('rec-name').value = recs[id].name || '';
      document.getElementById('rec-yomi').value = recs[id].yomi || '';
      try { recs[id].bianzheng ? localStorage.setItem('mos_bianzheng_result', recs[id].bianzheng) : localStorage.removeItem('mos_bianzheng_result'); } catch (e) {}
      restoreMosRaw(recs[id].mos_raw);
      syncTcmFieldsFromShared(true); // このカルテの舌脈スナップショットを表示欄にも反映
      updateStimulus(); // 内部で buildIntegratedPlanCard() も実行
      buildBianzhengCard();
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
      let bz = null; try { bz = JSON.parse(localStorage.getItem('mos_bianzheng_result') || 'null'); } catch (e) {}
      const bundle = { schema: 'karte_export', version: 1, exported_at: new Date().toISOString(), form: serializeForm(), records: loadRecords(), engine_output: eng, mos_bianzheng: bz, mos_raw: captureMosRaw() };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `karte_${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      setBackupMeta(Object.keys(bundle.records).length);
      buildBackupReminder();
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
          if (b.mos_bianzheng) { localStorage.setItem('mos_bianzheng_result', JSON.stringify(b.mos_bianzheng)); }
          if (b.mos_raw) restoreMosRaw(b.mos_raw);
          if (b.form) { applyData(b.form); saveForm(); }
          syncTcmFieldsFromShared(true);
          updateStimulus(); // 内部で buildIntegratedPlanCard() も実行
          buildBianzhengCard();
          setBackupMeta(Object.keys(loadRecords()).length);
          buildBackupReminder();
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
    buildBackupReminder(); // 最後にprependすることで一番上に表示（filledバナーより優先度が高い注意喚起のため）
  } catch (e) {
    app().innerHTML = `<div class="card error">カルテ様式の読み込みに失敗しました：${e.message}</div>`;
  }
}

init();

// 他タブ（東洋弁証MOSページ）での舌脈所見・確定証の編集を、開きっぱなしのカルテにも反映
window.addEventListener('storage', (e) => {
  if (e.key === TCM_SHARED_KEY) { syncTcmFieldsFromShared(true); updateStimulus(); }
  if (e.key === 'mos_bianzheng_result') { buildBianzhengCard(); buildIntegratedPlanCard(); }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
