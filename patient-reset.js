/* =====================================================================
   患者単位の作業データのリセット（共有リソース）
   karte.html / mos.html / intake.html から各ページのスクリプトより先に読み込む。
   「新しい患者」開始時に、前の患者の入力・判定結果が自動流し込みで
   次の患者へ伝播する事故（状態リーク）を防ぐ。
   ※ 保存済みカルテ(karte_records)・バックアップ記録(karte_backup_meta)は消さない。
   ===================================================================== */
// 患者単位の作業データのキー一覧（1患者の診察で発生する全localStorage）
const PATIENT_WORK_KEYS = [
  'karte_form_data',       // カルテ下書き
  'karte_engine_output',   // 鑑別エンジン出力（診断名・所見の自動流し込み元）
  'mos_bianzheng_result',  // 確定証（弁証カード・統合カードの元）
  'mos_answers',           // MOS 51問の生回答
  'mos_distinct_checks',   // 証候候補の相違点チェック
  'mos_selected_syndrome', // 選択中の証id
  'mos_scale_mode',        // M/Fスケール
  'tcm_shared_findings',   // 舌脈所見（カルテ・MOS共有）
  'intake_answers',        // 問診の回答
  'intake_step',           // 問診の進行位置
  'intake_return'          // 鑑別→問診の戻りフラグ
];

function resetPatientData() {
  PATIENT_WORK_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
}
