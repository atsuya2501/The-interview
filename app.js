/* =====================================================================
   痛み鑑別エンジン（首・最小版）
   処理順は固定：
   ① レッドフラッグゲート（赤=遮断 / 黄=警告つき通過）
   ② 局所/放散の分岐 → 候補疾患フィルタ
   ③ 動き質問 → 内臓関連痛の炙り出し
   ④ 徒手検査の confirm/exclude を Rank 集計
   ⑤ 神経根症が浮いたら高位診断（C5〜Th1）= 得点降順エンジン
   ⑥ treatment_track で治療マスタを引いて表示
   出力は確定診断ではなく「示唆」。
   ===================================================================== */

// ---- データ保持 ----
let DISEASES = [];     // 選択中部位の疾患マスタ
let BRANCHES = {};     // 選択中部位の branch 説明
let TREATMENTS = [];   // 治療マスタ（部位共通）
let TEST_METHODS = {}; // 検査名 → 実施方法（部位共通）
let OVERRIDES = [];    // 部位レベルの強制🔴オーバーライド [{signs,note,title}]（腹膜刺激/血管など）
let DERMATOME = null;  // 神経根デルマトームマップ（共有リソース）
let PERIPHERAL = null; // 末梢神経支配領域マップ（共有リソース）
let TRACK_MECH = null; // treatment_track → 機序id 対応（treatment_resolver）

// 部位定義。wrapped=true は [{...}] の配列ラップ（首）、false は素のオブジェクト（頭・腰）。
const REGIONS = {
  neck:   { label: '首', desc: '頚部・肩・上肢',     file: 'data/neck_diseases.json',   wrapped: true },
  head:   { label: '頭', desc: '頭痛・頭部',         file: 'data/head_diseases.json',   wrapped: false },
  lumbar: { label: '腰', desc: '腰部・殿部・下肢',   file: 'data/lumbar_diseases.json', wrapped: false },
  face:   { label: '顔', desc: '顔面・顎・口腔',     file: 'data/face_diseases.json',   wrapped: false },
  shoulder: { label: '肩', desc: '肩関節・肩周囲',   file: 'data/shoulder_diseases.json', wrapped: false },
  elbow:  { label: '肘', desc: '肘・前腕',           file: 'data/elbow_diseases.json',  wrapped: false },
  hand:   { label: '手', desc: '手首・手指',         file: 'data/hand_diseases.json',   wrapped: false },
  chest:  { label: '胸', desc: '胸部・胸壁',         file: 'data/chest_diseases.json',  wrapped: false },
  abdomen: { label: '腹', desc: '腹部・消化器',      file: 'data/abdomen_diseases.json', wrapped: false },
  thigh:  { label: '大腿', desc: '太もも・股関節',   file: 'data/thigh_diseases.json',  wrapped: false },
  knee:   { label: '膝', desc: '膝関節・膝周囲',     file: 'data/knee_diseases.json',   wrapped: false },
  lower_leg: { label: '下腿', desc: 'ふくらはぎ・すね', file: 'data/lower_leg_diseases.json', wrapped: false },
  foot:   { label: '足部', desc: '足・足関節・足趾', file: 'data/foot_diseases.json',    wrapped: false },
  systemic: { label: '全身', desc: '全身が痛い・全身性疾患', file: 'data/systemic_diseases.json', wrapped: false }
};

// ---- 設定（エンジンのチューニング箇所はここに集約） ----

// Rank → 重み（Step④/⑤共通）
const RANK_WEIGHT = { 1: 3, 2: 2, 3: 1 };

// prevalence → 事前確率の素点（Step④の土台）
const PREVALENCE_BASE = { common: 2, occasional: 1, rare_redflag: 0 };

// レッドフラッグゲート（①）。JSONに無い問診はここで定義。
const RED_FLAGS = [
  {
    id: 'horner',
    label: 'ホルネル徴候（片側の眼瞼下垂・縮瞳・顔の発汗低下）がある',
    level: 'red',
    title: 'パンコースト症候群の疑い',
    message: '肺尖部腫瘍の可能性があります。鍼治療の対象外です。速やかに医療機関を受診してください。'
  },
  {
    id: 'systemic',
    label: '安静・夜間でも痛みが続く、原因不明の体重減少や発熱を伴う',
    level: 'red',
    title: '全身性レッドフラッグ',
    message: '腫瘍・感染などの可能性。医療機関での精査が必要です。'
  },
  {
    id: 'patho_reflex',
    label: '病的反射が陽性（ホフマン/トレムナー/ワルテンベルグ）、または手の細かい動作・歩行がしにくい',
    level: 'yellow',
    title: '頚椎症性脊髄症の可能性',
    message: '脊髄障害のサインです。治療と並行して医療機関の受診を強く推奨します（治療は警告つきで継続可）。'
  }
];

// treatment_track → 治療マスタの抽出ルール（⑥）。編集可能なヒューリスティック。
const TRACK_MAP = {
  '局所筋骨格': t => t.level === '末梢',
  '神経系':     t => t.level === '末梢' || t.level === '脊髄' || t.id === 'descending_inhibition',
  '心理社会的': t => t.level === '脳',
  '自律神経':   t => t.id === 'somato_autonomic_reflex' || t.id === 'autonomic_regulation' || t.id === 'descending_inhibition',
  '要医療機関': () => false,
  '経過観察':   () => false,
  '腰橋渡し':   () => false
};
const TRACK_NOTE = {
  '局所筋骨格': '痛みの局所（末梢レベル）への治療が中心。',
  '神経系':     '末梢に加え、脊髄分節・下行性抑制を狙う治療を組み合わせる。',
  '心理社会的': '脳レベルへの働きかけ（自律神経調整など）を中心に。',
  '自律神経':   '体性-自律神経反射・脳レベルの調整を中心に。',
  '要医療機関': '鍼治療の対象外。医療機関での対応が必要。',
  '経過観察':   '鍼の適応となりうるが、改善しなければ受診勧奨。',
  '腰橋渡し':   '腰由来の関連痛の可能性。腰の鑑別を参照。'
};

// 神経根レベル（L3等）のデルマトーム情報を全領域から検索
function dermatomeInfo(level) {
  if (!DERMATOME || !DERMATOME.regions) return null;
  for (const rk of Object.keys(DERMATOME.regions)) {
    const p = DERMATOME.regions[rk].patterns && DERMATOME.regions[rk].patterns[level];
    if (p) return p;
  }
  return null;
}

// デルマトーム情報を「責任椎間 / 腱反射 / 運動 / 感覚」の1行に整形
function dermatomeDetailLine(level) {
  const di = dermatomeInfo(level);
  if (!di) return '';
  const parts = [
    di.responsible_disc_level ? `責任椎間 ${di.responsible_disc_level}` : '',
    (di.tendon_reflex && di.tendon_reflex !== '反射障害なし') ? `腱反射 ${di.tendon_reflex}(${di.tendon_reflex_change || ''})` : '',
    di.motor_deficit ? `運動 ${di.motor_deficit.join('・')}` : '',
    di.dermatome ? `感覚 ${di.dermatome}` : ''
  ].filter(Boolean);
  return parts.join(' / ');
}

// 疾患名から末梢神経支配領域を引く（related_diseases が疾患名に含まれるものを最長一致）
function findPeripheralNerve(diseaseName) {
  if (!PERIPHERAL || !PERIPHERAL.nerves) return null;
  let best = null, bestLen = 0;
  for (const nerveName of Object.keys(PERIPHERAL.nerves)) {
    const nerve = PERIPHERAL.nerves[nerveName];
    for (const rd of (nerve.related_diseases || [])) {
      if (diseaseName.includes(rd) && rd.length > bestLen) { best = { name: nerveName, nerve }; bestLen = rd.length; }
    }
  }
  return best;
}

// ---- 状態 ----
const state = {
  step: 0,             // 0=部位選択, 1〜6=本フロー, 99=結果/遮断
  region: null,        // 'neck' | 'head' | 'lumbar'
  redAnswers: {},      // redFlagId -> bool
  redWarnings: [],     // Step①の黄色警告
  branch: null,        // 部位ごとの branch 名
  candidates: [],      // 候補疾患（idの配列）
  movement: null,      // 'related' | 'unrelated'
  findingAnswers: {},  // signKey -> 'pos' | 'neg' (未回答はキー無し)
  levelAnswers: {},    // levelSignKey -> true
  scored: [],          // Step④の集計結果
  blockReasons: [],    // 遮断理由 [{title,message}]（Step①赤 or severity緊急）
  severityWarnings: [],// Step④の🟡警告（要医療機関だが非緊急）
};

const TOTAL_STEPS = 6;
const app = () => document.getElementById('app');

// =====================================================================
// 起動
// =====================================================================
async function init() {
  try {
    // 部位共通マスタ（治療・検査方法）を先読み
    const [tx, methods, derm, periph, trackMech] = await Promise.all([
      fetch('data/treatment_master.json').then(r => r.json()),
      fetch('data/test_methods.json').then(r => r.json()),
      fetch('data/dermatome_map.json').then(r => r.json()),
      fetch('data/peripheral_nerve_map.json').then(r => r.json()),
      fetch('data/track_to_mechanism.json').then(r => r.json())
    ]);
    TREATMENTS = tx[0].treatments;
    TEST_METHODS = methods.test_methods || {};
    DERMATOME = derm || null;
    PERIPHERAL = periph || null;
    TRACK_MECH = trackMech || null;
    renderStep(); // step 0 = 部位選択
  } catch (e) {
    app().innerHTML = `<div class="card error">データの読み込みに失敗しました：${e.message}</div>`;
  }
}

// severity 表記を正規化（絵文字・別表記 → 緊急/要注意/undefined）
function normSeverity(sev) {
  if (sev === '緊急' || sev === '🔴') return '緊急';
  if (sev === '要注意' || sev === '🟡') return '要注意';
  return undefined; // '無印' / undefined
}

// treatment_track を内部正準トラックに正規化（部位ごとの記述的トラックを吸収）。
// severity（警告/遮断）とは分離：トラックは「どのカードを出すか」だけを決める。
const MEDICAL_TRACKS = new Set(['要医療機関', '緊急医療', '骨折', '靭帯捻挫', '腱断裂', '痛風']);
const ACU_TRACKS = new Set(['局所筋骨格', '神経系', '心理社会的', '自律神経',
  '全身調整・対症', '末梢神経絞扼', '足底腱膜・筋膜', '腱・腱付着部',
  '変形・アライメント', '変形性関節症', '骨・付着部', '対症・足底ケア']);
function canonTrack(d) {
  const t = d.treatment_track;
  if (t === '経過観察') return '経過観察';
  if (t === '腰部参照' || t === '頭部参照' || t === '腰橋渡し' || d.referral_to_lumbar || d.referral_to_head) return '腰橋渡し';
  if (MEDICAL_TRACKS.has(t)) return '要医療機関';
  if (t === '局所筋骨格' || t === '神経系' || t === '心理社会的' || t === '自律神経') return t;
  if (ACU_TRACKS.has(t)) return '局所筋骨格'; // 記述的な鍼適応トラックは局所筋骨格に集約
  // 未知トラック：severityで医療/局所を判定
  const sev = normSeverity(d.severity);
  return (sev === '緊急' || sev === '要注意') ? '要医療機関' : '局所筋骨格';
}

// 選択部位の疾患マスタを読み込み、内部正準形に正規化する
async function loadRegion(key) {
  const cfg = REGIONS[key];
  const raw = await fetch(cfg.file).then(r => r.json());
  const root = cfg.wrapped ? raw[0] : raw;

  // branches: 配列形式 {id,name,...} ↔ オブジェクト形式 {name:desc} を吸収
  const idToName = {};
  if (Array.isArray(root.branches)) {
    BRANCHES = {};
    root.branches.forEach(b => { BRANCHES[b.name] = b.desc || b.name; idToName[b.id] = b.name; });
  } else {
    BRANCHES = root.branches || {};
  }

  // diseases: branch(配列/文字列)→表示名配列、severity/track 正規化、follow_up 入れ子の平坦化
  DISEASES = (root.diseases || []).map(d => {
    const bs = Array.isArray(d.branch) ? d.branch : [d.branch];
    d._branches = bs.map(b => idToName[b] || b);
    d._severity = normSeverity(d.severity);
    d._track = canonTrack(d);
    if (d.follow_up && d.follow_up.follow_up_threshold && !d.follow_up_threshold) {
      d.follow_up_threshold = d.follow_up.follow_up_threshold;
    }
    return d;
  });

  // 強制🔴オーバーライド（腹膜刺激/血管系など）を統一形に収集
  OVERRIDES = [];
  if (root.peritoneal_sign_override) {
    OVERRIDES.push({ signs: root.peritoneal_sign_override.signs || [], note: root.peritoneal_sign_override.note, title: '腹膜刺激徴候陽性' });
  }
  if (root.overrides) {
    for (const k of Object.keys(root.overrides)) {
      const o = root.overrides[k];
      OVERRIDES.push({ signs: o.trigger_any || o.signs || [], note: o.note, title: '緊急所見陽性（要医療機関）' });
    }
  }
  state.region = key;
}

function diseaseById(id) { return DISEASES.find(d => d.id === id); }

// 所見名（例「イートンテスト陽性」「残尿が500ml以上」）から test_methods のキーを引く。
// まずキー全体の部分一致、無ければ接尾辞（測定/検査/テスト/試験/法）を除いた語幹で再照合。
// いずれも最長一致を優先。
const TEST_KEY_SUFFIXES = ['測定', '検査', 'テスト', '試験', '法'];
function testKeyCore(name) {
  for (const suf of TEST_KEY_SUFFIXES) {
    if (name.endsWith(suf) && name.length - suf.length >= 2) return name.slice(0, -suf.length);
  }
  return null;
}
function findTestMethod(sign) {
  let best = null, bestLen = 0;
  for (const name of Object.keys(TEST_METHODS)) {
    let matchLen = 0;
    if (sign.includes(name)) {
      matchLen = name.length;
    } else {
      const core = testKeyCore(name);
      if (core && sign.includes(core)) matchLen = core.length;
    }
    if (matchLen > bestLen) { best = name; bestLen = matchLen; }
  }
  return best ? { name: best, how: TEST_METHODS[best] } : null;
}

function renderProgress() {
  const bar = document.getElementById('progress');
  const pct = state.step < 1 ? 0 : Math.round(((state.step - 1) / TOTAL_STEPS) * 100);
  bar.innerHTML = `<div class="progress-fill" style="width:${state.step >= 99 ? 100 : pct}%"></div>`;
}

function renderStep() {
  renderProgress();
  switch (state.step) {
    case 0: renderRegion(); break;
    case 1: renderRedFlags(); break;
    case 2: renderBranch(); break;
    case 3: renderMovement(); break;
    case 4: renderFindings(); break;
    case 5: renderLevel(); break;
    case 6: renderTreatment(); break;
    case 99: renderBlocked(); break;
  }
  injectBackButton();
}

// 各ステップに「← 戻る」を付与（誤タップ時に1つ前へ戻れる）
function injectBackButton() {
  if (![1, 2, 3, 4, 5].includes(state.step)) return;
  const card = app().querySelector('.card');
  if (!card) return;
  const back = document.createElement('button');
  back.className = 'btn back-btn';
  back.textContent = '← 戻る';
  back.addEventListener('click', () => { state.step = state.step - 1; renderStep(); });
  card.appendChild(back);
}

// =====================================================================
// ⓪ 部位選択
// =====================================================================
function renderRegion() {
  const opts = Object.keys(REGIONS).map(key => {
    const r = REGIONS[key];
    return `<button class="option" data-region="${key}">
      <span class="opt-title">${r.label}</span>
      <span class="opt-desc">${r.desc}</span>
    </button>`;
  }).join('');

  app().innerHTML = `
    <section class="card">
      <div class="step-tag">部位を選択</div>
      <h2>どこの痛みですか？</h2>
      <p class="lead">鑑別する部位を選んでください。</p>
      <div class="options">${opts}</div>
    </section>`;

  app().querySelectorAll('[data-region]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await loadRegion(btn.dataset.region);
        state.step = 1;
        renderStep();
      } catch (e) {
        app().innerHTML = `<div class="card error">部位データの読み込みに失敗しました：${e.message}</div>`;
      }
    });
  });
}

function stepHeader(n, title) {
  return `<div class="step-tag">STEP ${n} / ${TOTAL_STEPS}</div><h2>${title}</h2>`;
}

// =====================================================================
// ① レッドフラッグゲート
// =====================================================================
function renderRedFlags() {
  const items = RED_FLAGS.map(f => `
    <label class="check ${f.level}">
      <input type="checkbox" data-rf="${f.id}" ${state.redAnswers[f.id] ? 'checked' : ''}>
      <span class="dot ${f.level}"></span>
      <span class="check-label">${f.label}</span>
    </label>`).join('');

  app().innerHTML = `
    <section class="card">
      ${stepHeader(1, 'レッドフラッグの確認')}
      <p class="lead">当てはまるものにチェック。<span class="dot red inline"></span>赤=遮断 / <span class="dot yellow inline"></span>黄=警告つき通過。</p>
      <div class="checks">${items}</div>
      <div class="actions">
        <button class="btn primary" id="next1">判定して次へ →</button>
      </div>
    </section>`;

  app().querySelectorAll('[data-rf]').forEach(cb => {
    cb.addEventListener('change', e => {
      state.redAnswers[e.target.dataset.rf] = e.target.checked;
    });
  });

  document.getElementById('next1').addEventListener('click', () => {
    state.blockReasons = [];
    state.redWarnings = [];
    for (const f of RED_FLAGS) {
      if (state.redAnswers[f.id]) {
        if (f.level === 'red') state.blockReasons.push({ title: f.title, message: f.message });
        else state.redWarnings.push(f);
      }
    }
    state.step = state.blockReasons.length ? 99 : 2;
    renderStep();
  });
}

function renderBlocked() {
  app().innerHTML = `
    <section class="card block">
      <div class="block-badge">🔴 遮断</div>
      <h2>鍼治療の対象外の可能性</h2>
      ${state.blockReasons.map(r => `<div class="alert red"><strong>${r.title}</strong><p>${r.message}</p></div>`).join('')}
      <p class="lead">医療機関での対応を優先してください。</p>
      <div class="actions"><button class="btn" id="restart">最初からやり直す</button></div>
    </section>`;
  document.getElementById('restart').addEventListener('click', restart);
}

// =====================================================================
// ② 局所/放散の分岐
// =====================================================================
function renderBranch() {
  const warnHtml = state.redWarnings.map(f =>
    `<div class="alert yellow"><strong>⚠ ${f.title}</strong><p>${f.message}</p></div>`).join('');

  const opts = Object.keys(BRANCHES).map(name => `
        <button class="option" data-branch="${name}">
          <span class="opt-title">${name}</span>
          <span class="opt-desc">${BRANCHES[name]}</span>
        </button>`).join('');

  app().innerHTML = `
    <section class="card">
      ${stepHeader(2, '痛みの広がり方')}
      ${warnHtml}
      <p class="lead">痛み・しびれの分布に近いのは？</p>
      <div class="options">${opts}</div>
    </section>`;

  app().querySelectorAll('[data-branch]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.branch = btn.dataset.branch;
      state.candidates = DISEASES
        .filter(d => (d._branches || [d.branch]).includes(state.branch))
        .map(d => d.id);
      state.step = 3;
      renderStep();
    });
  });
}

// =====================================================================
// ③ 動き質問 → 内臓関連痛の炙り出し
// =====================================================================
function renderMovement() {
  app().innerHTML = `
    <section class="card">
      ${stepHeader(3, '動きとの関係')}
      <p class="lead">痛む部位を<strong>動かすと痛みは変化</strong>しますか？</p>
      <div class="options">
        <button class="option" data-mv="related">
          <span class="opt-title">動きで変化する</span>
          <span class="opt-desc">姿勢や運動で痛みが増減する（筋骨格・神経系を示唆）</span>
        </button>
        <button class="option" data-mv="unrelated">
          <span class="opt-title">動きと無関係</span>
          <span class="opt-desc">じっとしていても同じように痛む（内臓関連痛を示唆）</span>
        </button>
      </div>
    </section>`;

  app().querySelectorAll('[data-mv]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.movement = btn.dataset.mv;
      // 動きとの整合で候補を絞る（部位非依存）。
      //   動くと変化する → movement_related===false（片頭痛・内臓関連痛など）を除外
      //   動きと無関係   → movement_related===true（要・運動誘発の筋骨格系）を除外
      // movement_related 未指定の疾患はどちらでも残す。
      // 内臓関連痛・要医療機関などの危険群は結果画面で常時表示されるため、
      // 「動きと無関係」を選ぶと自然に上位へ炙り出される。
      state.candidates = state.candidates.filter(id => {
        const d = diseaseById(id);
        if (!d || d.movement_related === undefined) return true;
        return state.movement === 'related' ? d.movement_related === true
                                            : d.movement_related === false;
      });
      state.step = 4;
      renderStep();
    });
  });
}

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
      state.findingAnswers[k] = state.findingAnswers[k] === v ? undefined : v;
      renderStep();
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
    const acute = (s.hits || []).some(h => h.ans === 'pos' && (h.sign.includes('急性') || h.sign.includes('激痛')));
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
           <p class="tx-track">治療方針：<strong>${s.disease.treatment_track}</strong> — ${TRACK_NOTE[track] || ''}</p>
           ${resolved && resolved.reason ? `<p class="resolver-reason">🧭 ${resolved.reason}</p>` : ''}
           ${txs.map(t => `
             <div class="tx">
               <div class="tx-head">${(resolved && resolved.primarySet.has(t.id)) ? '<span class="tag primary-tag">第一選択</span> ' : ''}${t.mechanism} <span class="tag">${t.category}</span> <span class="tag light">${t.level}</span></div>
               <div class="tx-body">
                 <div><b>刺激部位</b> ${t.stimulus_site}</div>
                 <div><b>治療点</b> ${t.treatment_location}</div>
                 <div><b>手技</b> ${t.technique}</div>
                 <div><b>神経線維</b> ${t.nerve_fiber.join('・')}</div>
               </div>
             </div>`).join('')}
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

  app().innerHTML = `
    <section class="result">
      <div class="result-banner">示唆される鑑別（確定診断ではありません）</div>
      ${warnHtml}
      ${levelHtml}
      ${sugHtml}
      <div class="actions">
        ${localStorage.getItem('intake_return') === '1'
          ? '<a class="btn primary" href="intake.html#step-4">問診へ戻る（Step4へ）→</a>' : ''}
        <button class="btn" id="restart">最初からやり直す</button>
      </div>
    </section>`;
  document.getElementById('restart').addEventListener('click', restart);
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
