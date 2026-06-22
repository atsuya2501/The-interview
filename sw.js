const CACHE = 'itami-kanbe-v34';
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
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
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

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached ?? fetch(e.request))
  );
});
