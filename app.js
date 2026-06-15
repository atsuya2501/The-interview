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
let DISEASES = [];     // 疾患マスタ
let BRANCHES = {};     // 局所/放散の説明
let TREATMENTS = [];   // 治療マスタ

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
  '要医療機関': () => false
};
const TRACK_NOTE = {
  '局所筋骨格': '痛みの局所（末梢レベル）への治療が中心。',
  '神経系':     '末梢に加え、脊髄分節・下行性抑制を狙う治療を組み合わせる。',
  '心理社会的': '脳レベルへの働きかけ（自律神経調整など）を中心に。',
  '要医療機関': '鍼治療の対象外。医療機関での対応が必要。'
};

// ---- 状態 ----
const state = {
  step: 1,
  redAnswers: {},      // redFlagId -> bool
  redBlocked: false,
  redWarnings: [],
  branch: null,        // '局所' | '放散'
  candidates: [],      // 候補疾患（idの配列）
  movement: null,      // 'related' | 'unrelated'
  visceralFlag: false,
  findingAnswers: {},  // signKey -> 'pos' | 'neg' (未回答はキー無し)
  levelAnswers: {},    // levelSignKey -> true
  scored: [],          // Step④の集計結果
};

const TOTAL_STEPS = 6;
const app = () => document.getElementById('app');

// =====================================================================
// 起動
// =====================================================================
async function init() {
  try {
    const [neck, tx] = await Promise.all([
      fetch('data/neck_diseases.json').then(r => r.json()),
      fetch('data/treatment_master.json').then(r => r.json())
    ]);
    const neckRoot = neck[0];
    DISEASES = neckRoot.diseases;
    BRANCHES = neckRoot.branches;
    TREATMENTS = tx[0].treatments;
    renderStep();
  } catch (e) {
    app().innerHTML = `<div class="card error">データの読み込みに失敗しました：${e.message}</div>`;
  }
}

function diseaseById(id) { return DISEASES.find(d => d.id === id); }

function renderProgress() {
  const bar = document.getElementById('progress');
  const pct = Math.round(((state.step - 1) / TOTAL_STEPS) * 100);
  bar.innerHTML = `<div class="progress-fill" style="width:${state.step >= 99 ? 100 : pct}%"></div>`;
}

function renderStep() {
  renderProgress();
  switch (state.step) {
    case 1: return renderRedFlags();
    case 2: return renderBranch();
    case 3: return renderMovement();
    case 4: return renderFindings();
    case 5: return renderLevel();
    case 6: return renderTreatment();
    case 99: return renderBlocked();
  }
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
    state.redBlocked = false;
    state.redWarnings = [];
    for (const f of RED_FLAGS) {
      if (state.redAnswers[f.id]) {
        if (f.level === 'red') state.redBlocked = true;
        else state.redWarnings.push(f);
      }
    }
    if (state.redBlocked) {
      state.step = 99;
    } else {
      state.step = 2;
    }
    renderStep();
  });
}

function renderBlocked() {
  const reds = RED_FLAGS.filter(f => f.level === 'red' && state.redAnswers[f.id]);
  app().innerHTML = `
    <section class="card block">
      <div class="block-badge">遮断</div>
      <h2>鍼治療の対象外の可能性</h2>
      ${reds.map(f => `<div class="alert red"><strong>${f.title}</strong><p>${f.message}</p></div>`).join('')}
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

  app().innerHTML = `
    <section class="card">
      ${stepHeader(2, '痛みの広がり方')}
      ${warnHtml}
      <p class="lead">痛み・しびれの分布に近いのは？</p>
      <div class="options">
        <button class="option" data-branch="局所">
          <span class="opt-title">局所</span>
          <span class="opt-desc">${BRANCHES['局所']}</span>
        </button>
        <button class="option" data-branch="放散">
          <span class="opt-title">放散</span>
          <span class="opt-desc">${BRANCHES['放散']}</span>
        </button>
      </div>
    </section>`;

  app().querySelectorAll('[data-branch]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.branch = btn.dataset.branch;
      state.candidates = DISEASES
        .filter(d => d.branch === state.branch)
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
      <p class="lead">首・肩・腕を<strong>動かすと痛みは変化</strong>しますか？</p>
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
      const visceral = state.candidates
        .map(diseaseById)
        .filter(d => d && d.movement_related === false);

      if (state.movement === 'unrelated' && visceral.length) {
        // 内臓関連痛を炙り出し
        state.visceralFlag = true;
        state.candidates = visceral.map(d => d.id);
      } else {
        // 動きと関係 → 動きと無関係な疾患（内臓）を候補から除外
        state.visceralFlag = false;
        state.candidates = state.candidates.filter(id => {
          const d = diseaseById(id);
          return !(d && d.movement_related === false);
        });
      }
      state.step = 4;
      renderStep();
    });
  });
}

// =====================================================================
// ④ 徒手検査 confirm/exclude を Rank 集計
// =====================================================================

// 1つの所見の寄与：方向はLR（≥1で陽性方向）、大きさはRank重み
function signContribution(finding) {
  const dir = finding.lr >= 1 ? 1 : -1;
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

  if (state.visceralFlag || items.length === 0) {
    // 検査対象が無い（内臓炙り出し済み等）→ 集計だけして次へ
    state.scored = scoreCandidates();
    state.step = needLevel() ? 5 : 6;
    return renderStep();
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
      return `
        <div class="finding">
          <div class="finding-info">
            <span class="finding-sign">${it.sign}</span>
            <span class="finding-meta">${sub} ・ ${lrTxt} ・ R${it.rank}</span>
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

  document.getElementById('next4').addEventListener('click', () => {
    state.scored = scoreCandidates();
    state.step = needLevel() ? 5 : 6;
    renderStep();
  });
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
        contrib = signContribution(it) * (ans === 'pos' ? 1 : -1);
      } else { // test
        contrib = (ans === 'pos' ? 1 : 0) * (RANK_WEIGHT[it.rank] || 1);
      }
      if (contrib !== 0) hits.push({ sign: it.sign, contrib, ans });
      findingScore += contrib;
    });
    return { id, name: d.name, base, findingScore, total: base + findingScore, hits, disease: d };
  }).sort((a, b) => b.total - a.total);
}

// 神経根症が「浮いた」か判定（高位診断が必要か）
function needLevel() {
  const rad = state.scored.find(s => s.id === 'cervical_radiculopathy');
  if (!rad) return false;
  // 所見で陽性方向に振れている、かつ上位に来ている
  return rad.findingScore > 0 && rad === state.scored[0];
}

// =====================================================================
// ⑤ 高位診断（C5〜Th1）= 得点降順エンジン
// =====================================================================
function renderLevel() {
  const rad = diseaseById('cervical_radiculopathy');
  const loc = rad.level_localization;
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
      ${stepHeader(5, '神経根症の高位診断（C5〜Th1）')}
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
  const rad = diseaseById('cervical_radiculopathy');
  const loc = rad.level_localization;
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

function renderTreatment() {
  state.step = 99; // 結果画面（プログレス満タン）
  renderProgress();

  // 表示する示唆：スコア降順。要医療機関・レッドフラッグはスコアに関わらず常に表示。
  const isDanger = d => d.prevalence === 'rare_redflag' || d.treatment_track === '要医療機関';
  const suggestions = state.scored.filter(s => s.total > 0 || isDanger(s.disease));

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
            <div class="level-signs">${l.matched.join(' / ')}</div>`).join('')}
          <p class="hint">最も示唆される高位：<strong>${levels[0].level}</strong></p>
        </div>`;
    }
  }

  // 示唆カード
  const maxTotal = Math.max(...suggestions.map(s => s.total), 1);
  const sugHtml = suggestions.length ? suggestions.map((s, i) => {
    const txs = treatmentsForTrack(s.disease.treatment_track);
    const isRed = s.disease.prevalence === 'rare_redflag' || s.disease.treatment_track === '要医療機関';
    const hitTxt = s.hits.length
      ? `<ul class="hit-list">${s.hits.map(h =>
          `<li>${h.sign} <span class="${h.contrib > 0 ? 'plus' : 'minus'}">${h.contrib > 0 ? '+' : ''}${h.contrib}</span></li>`).join('')}</ul>`
      : '<p class="hint">所見入力なし（有病率の事前確率のみ）</p>';

    const txHtml = isRed
      ? `<div class="alert red"><strong>要医療機関</strong><p>${TRACK_NOTE['要医療機関']}${s.disease.note ? '<br>' + s.disease.note : ''}</p></div>`
      : `<div class="tx-block">
           <p class="tx-track">治療方針：<strong>${s.disease.treatment_track}</strong> — ${TRACK_NOTE[s.disease.treatment_track] || ''}</p>
           ${txs.map(t => `
             <div class="tx">
               <div class="tx-head">${t.mechanism} <span class="tag">${t.category}</span> <span class="tag light">${t.level}</span></div>
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
        ${s.disease.note && !isRed ? `<p class="note">📝 ${s.disease.note}</p>` : ''}
        ${hitTxt}
        ${txHtml}
      </div>`;
  }).join('') : `<div class="card"><p class="lead">明確に示唆される疾患はありませんでした。問診・所見を見直してください。</p></div>`;

  const warnHtml = state.redWarnings.map(f =>
    `<div class="alert yellow"><strong>⚠ ${f.title}</strong><p>${f.message}</p></div>`).join('');

  app().innerHTML = `
    <section class="result">
      <div class="result-banner">示唆される鑑別（確定診断ではありません）</div>
      ${warnHtml}
      ${levelHtml}
      ${sugHtml}
      <div class="actions">
        <button class="btn" id="restart">最初からやり直す</button>
      </div>
    </section>`;
  document.getElementById('restart').addEventListener('click', restart);
}

function restart() {
  state.step = 1;
  state.redAnswers = {};
  state.redBlocked = false;
  state.redWarnings = [];
  state.branch = null;
  state.candidates = [];
  state.movement = null;
  state.visceralFlag = false;
  state.findingAnswers = {};
  state.levelAnswers = {};
  state.scored = [];
  renderStep();
}

// =====================================================================
// 起動 & Service Worker
// =====================================================================
init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
