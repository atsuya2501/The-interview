/* =====================================================================
   カルテ様式シェル
   karte_schema.json / tcm_findings.json からフォームを自動生成する。
   ロジックは持たず「形だけ」（脈・舌などは術者が記入）。
   鑑別エンジンの結果（localStorage: karte_engine_output）を engine_output 欄に自動流し込み。
   ===================================================================== */

const app = () => document.getElementById('karte');
const META = new Set(['schema_name', 'version', 'description', 'shared_by', 'master_type', 'fallback', 'architecture_note', 'severity_policy', 'level_handling']);

// 日本語ラベル辞書（無いキーは prettify でフォールバック）
const LABELS = {
  // セクション
  profile: '基本情報', engine_output: '鑑別エンジン出力（自動入力）', checks: '確認項目',
  exam_physical: '徒手検査（錐体路・錐体外路）', exam_spinal: '脊髄系の診察', exam_bone: '骨の診察',
  exam_joint: '関節の診察', exam_muscle: '筋の診察', exam_psych: '精神面', notes: '備考',
  pulse: '脈', tongue: '舌', muscle_hardness: '硬さ（抗重力筋）',
  // profile
  karte_no: 'カルテNo', name: '氏名', birth_date: '生年月日', age: '年齢', sex: '性別',
  disease_duration_years: '罹患期間（年）', chief_complaint: '主訴', diagnosis_name: '診断名',
  // step1/2
  pain_duration: '痛みの持続期間', classification: '急性/慢性', pain_quality: '痛みの性質',
  pain_range: '痛みの範囲', relief_factor: '軽快因子', aggravation_factor: '増悪因子',
  predicted_tissue: '予想される組織',
  // step3 exams
  balre_sign: 'バレー徴候', pronation_supination: '回内・回外運動', pathological_reflex: '病的反射',
  reflex: '腱反射', muscle_strength: '筋力', sensory: '感覚', percussion_pain: '叩打痛',
  heat: '熱感', swelling: '腫脹', redness: '発赤', rom_test: 'ROMテスト', tenderness: '圧痛',
  interest_loss: '興味・関心の低下', pain_location_and_state: '部位と痛みの性状',
  region: '部位', branch: '分類', confirmed_disease: '示唆疾患', differential_candidates: '鑑別候補',
  cause_tissue: '原因組織', treatment_track: '治療トラック',
  // step4
  present: 'レッドフラッグ', content: '内容', severe_pain: '激しい痛み', motor_disturbance: '運動障害',
  autonomic_reaction: '自律神経反応', widespread_pain: '全身/半身の痛み', progressive_48h: '48時間以上で悪化',
  bladder_bowel_dysfunction: '膀胱直腸障害',
  // step5
  level: '痛みのレベル', pain_distribution: '痛みの分布', cold_symptoms: '冷え',
  postural_change_muscle_tension: '姿勢変化・筋緊張', diarrhea_constipation: '下痢・便秘',
  dry_mouth_eye: 'ドライマウス/アイ', weather_sensitivity: '天気で変化', emotion_sensitivity: '感情で変化',
  thought_related_change: '思考に関連して変化', sleep_disturbance: '睡眠障害',
  // step6
  rest_until_cured: '治るまで休むべきと考える', limiting_activities: 'やりたいことを制限',
  rest_is_best: '安静が一番と考える', movement_worsens: '動くと悪化すると思う',
  past_work_absence: '痛みで休職した経験', constant_anxiety_tension: '常に不安・緊張',
  constant_depression: '常に憂うつ', heavy_or_monotonous_work: '重労働・単純作業', result: '結果',
  // step7 / stimulus / tcm
  short_term: '短期目標', long_term: '長期目標', final: '最終目標', phase: '時期',
  strength: '脈の強さ', color: '舌の色', shape: '舌の形', value: '硬さ',
  // treatment
  treatment_location: '治療部位', tools_used: '使用する道具', mechanism: '機序',
  technique: '手技', needle_size: '鍼の太さ', treatment_time: '治療時間', other_options: 'その他',
  special_notes: '特記事項', past_history: '既往歴', family_history: '家族歴', medication: '服薬'
};

function labelFor(key) { return LABELS[key] || key.replace(/_/g, ' '); }

// 値ノードをフィールドHTMLに変換（data-path で後から流し込み可能に）
function renderField(path, key, val, enumArr) {
  const dp = `${path}.${key}`;
  const label = labelFor(key);

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

// セクション（オブジェクト）を再帰描画
function renderSection(name, obj, depth, prefix) {
  const path = prefix ? `${prefix}.${name}` : name;
  const title = obj.label || labelFor(name);
  const fieldKeys = Object.keys(obj).filter(k => !k.startsWith('_') && k !== 'label');

  const body = fieldKeys.map(fk => {
    const val = obj[fk];
    const enumArr = obj['_enum_' + fk];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return renderSection(fk, val, depth + 1, path);
    }
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
  return `<section class="card k-section"><h2>東洋医学的所見（脈・舌・硬さ）</h2><p class="lead">刺激量・時期判定の参考。術者が記入。</p>${blocks}</section>`;
}

// エンジン結果を engine_output 欄に流し込む
function prefillFromEngine() {
  let data;
  try { data = JSON.parse(localStorage.getItem('karte_engine_output') || 'null'); } catch (e) { data = null; }
  if (!data) return null;
  const set = (dp, v) => {
    if (v == null || v === '') return;
    const el = document.querySelector(`[data-path="${dp}"]`);
    if (el) el.value = Array.isArray(v) ? v.join(' / ') : v;
  };
  const base = 'step3_disease.engine_output';
  set(`${base}.region`, data.region);
  set(`${base}.branch`, data.branch);
  set(`${base}.confirmed_disease`, data.confirmed_disease);
  set(`${base}.differential_candidates`, data.differential_candidates);
  set(`${base}.cause_tissue`, data.cause_tissue);
  set(`${base}.treatment_track`, data.treatment_track);
  set('profile.diagnosis_name', data.confirmed_disease);
  return data;
}

async function init() {
  try {
    const [karte, tcm] = await Promise.all([
      fetch('data/karte_schema.json').then(r => r.json()),
      fetch('data/tcm_findings.json').then(r => r.json())
    ]);

    const order = Object.keys(karte).filter(k => !META.has(k) && typeof karte[k] === 'object');
    let html = '';
    for (const k of order) {
      html += renderSection(k, karte[k], 0, '');
      if (k === 'stimulus_decision') html += renderTcm(tcm);
    }
    html += `<div class="actions">
      <button class="btn" onclick="window.print()">🖨 印刷</button>
      <a class="btn" href="index.html">← 鑑別へ戻る</a>
    </div>`;
    app().innerHTML = html;

    const filled = prefillFromEngine();
    if (filled) {
      const banner = document.createElement('div');
      banner.className = 'card';
      banner.innerHTML = `<p class="lead">🗂 直近の鑑別結果（${filled.saved_at || ''}）を「鑑別エンジン出力」「診断名」に自動入力しました。必要に応じて修正してください。</p>`;
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
