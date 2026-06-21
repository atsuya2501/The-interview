/* =====================================================================
   カルテ様式シェル
   karte_schema.json / tcm_findings.json からフォームを自動生成する。
   ロジックは持たず「形だけ」（脈・舌などは術者が手書き/入力で埋める）。
   入力は保存しない（印刷・運用前提）。
   ===================================================================== */

const app = () => document.getElementById('karte');
const META = new Set(['schema_name', 'version', 'description', 'shared_by', 'master_type', 'fallback', 'architecture_note', 'severity_policy', 'level_handling']);

function prettify(key) {
  return key.replace(/_/g, ' ');
}

// 値ノードをフィールドHTMLに変換
function renderField(parentLabel, key, val, enumArr) {
  const id = `${parentLabel}.${key}`.replace(/[^\w.]/g, '_');
  const label = prettify(key);

  // 配列：enumあり→チェックボックス群 / なし→自由記述
  if (Array.isArray(val)) {
    if (enumArr && enumArr.length) {
      const boxes = enumArr.map((opt, i) => `
        <label class="k-check"><input type="checkbox" name="${id}" value="${opt}"> ${opt}</label>`).join('');
      return `<div class="k-field"><span class="k-label">${label}</span><div class="k-checks">${boxes}</div></div>`;
    }
    return `<div class="k-field"><span class="k-label">${label}</span><textarea rows="2" placeholder="自由記述（複数可）"></textarea></div>`;
  }

  // enumあり→セレクト
  if (enumArr && enumArr.length) {
    const opts = ['<option value=""></option>'].concat(enumArr.map(o => `<option>${o}</option>`)).join('');
    return `<div class="k-field"><span class="k-label">${label}</span><select>${opts}</select></div>`;
  }

  // それ以外→テキスト入力（boolean系チェックは「あり/なし」セレクト）
  return `<div class="k-field"><span class="k-label">${label}</span><input type="text" placeholder=""></div>`;
}

// セクション（オブジェクト）を再帰描画
function renderSection(name, obj, depth) {
  const title = obj.label || prettify(name);
  const fieldKeys = Object.keys(obj).filter(k => !k.startsWith('_') && k !== 'label');

  const body = fieldKeys.map(fk => {
    const val = obj[fk];
    const enumArr = obj['_enum_' + fk];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return renderSection(fk, val, depth + 1); // ネスト（checks, exam_*, engine_output 等）
    }
    return renderField(name, fk, val, enumArr);
  }).join('');

  const tag = depth === 0 ? 'section' : 'div';
  const cls = depth === 0 ? 'card k-section' : 'k-subsection';
  return `<${tag} class="${cls}"><${depth === 0 ? 'h2' : 'h3'}>${title}</${depth === 0 ? 'h2' : 'h3'}>${body}</${tag}>`;
}

// tcm_findings を東洋医学所見セクションとして描画
function renderTcm(tcm) {
  const blocks = ['pulse', 'tongue', 'muscle_hardness'].map(k => {
    const node = tcm[k];
    if (!node) return '';
    return renderSection(k, node, 1);
  }).join('');
  return `<section class="card k-section"><h2>東洋医学的所見（脈・舌・硬さ）</h2><p class="lead">刺激量・時期判定の参考。術者が記入。</p>${blocks}</section>`;
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
      html += renderSection(k, karte[k], 0);
      // 刺激量決定の直後に東洋医学所見フォームを差し込む
      if (k === 'stimulus_decision') html += renderTcm(tcm);
    }

    html += `<div class="actions">
      <button class="btn" onclick="window.print()">🖨 印刷</button>
      <a class="btn" href="index.html">← 鑑別へ戻る</a>
    </div>`;

    app().innerHTML = html;
  } catch (e) {
    app().innerHTML = `<div class="card error">カルテ様式の読み込みに失敗しました：${e.message}</div>`;
  }
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
