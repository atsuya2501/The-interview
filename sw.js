const CACHE = 'itami-kanbe-v48';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/app-engine.js',
  '/karte.html',
  '/karte.js',
  '/intake.html',
  '/intake.js',
  '/mos.html',
  '/mos-engine.js',
  '/data/mos_questions.json',
  '/data/mos_scoring.json',
  '/data/tcm_bianzheng.json',
  '/data/acupoints.json',
  '/icons/icon.svg',
  '/data/neck_diseases.json',
  '/data/head_diseases.json',
  '/data/lumbar_diseases.json',
  '/data/face_diseases.json',
  '/data/shoulder_diseases.json',
  '/data/elbow_diseases.json',
  '/data/hand_diseases.json',
  '/data/chest_diseases.json',
  '/data/abdomen_diseases.json',
  '/data/thigh_diseases.json',
  '/data/knee_diseases.json',
  '/data/lower_leg_diseases.json',
  '/data/foot_diseases.json',
  '/data/systemic_diseases.json',
  '/data/karte_schema.json',
  '/data/intake_flow.json',
  '/data/tcm_findings.json',
  '/data/track_to_mechanism.json',
  '/data/stimulus_modulation.json',
  '/data/electrotherapy_params.json',
  '/data/patient_scripts.json',
  '/data/treatment_master.json',
  '/data/test_methods.json',
  '/data/dermatome_map.json',
  '/data/peripheral_nerve_map.json',
];

self.addEventListener('install', e => {
  // 一部アセットが404でも install を失敗させない（プロジェクトページ等の絶対パスずれ対策）
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// network-first：オンラインなら常に最新を取得しキャッシュ更新、失敗時のみキャッシュへフォールバック。
// → 通常リロード1回で更新が反映。オフラインでもキャッシュで動作。
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部リソースは介入しない
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(cached =>
        cached || (req.mode === 'navigate'
          ? caches.match('index.html').then(x => x || caches.match('/index.html'))
          : undefined)))
  );
});
