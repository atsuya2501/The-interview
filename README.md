# 痛み鑑別 PWA

鍼灸臨床向けの痛み鑑別支援ツール。バニラ HTML/CSS/JS（フレームワークなし）・PWA・GitHub Pages デプロイ前提。
**確定診断ではなく「示唆」を提示**し、最終判断は医療者が行う前提の補助ツール。

## 画面
- **鑑別（index.html）** … 部位選択 → ①レッドフラッグ ②局所/放散などの分岐 ③動き ④徒手検査(Rank集計) ⑤高位診断 ⑥治療トラック の固定フロー。結果を localStorage に保存しカルテへ受け渡し。
- **問診（intake.html）** … 早見表 Step1/2/4/5/6 を質問化。回答からカルテ欄（急性慢性・予想組織・レッド/イエローフラッグ・痛みレベル）を自動導出。Step3 は鑑別エンジンへ。
- **カルテ（karte.html）** … スキーマ駆動のフォーム。鑑別/問診の結果を自動流し込み、治療プラン（機序・鍼通電パラメータ）も resolver で提案。複数保存／呼び出し／JSON書き出し読み込み／印刷。

## 対応部位（14）
首・頭・腰・顔・肩・肘・手・胸・腹・大腿・膝・下腿・足部・全身

## データ（data/）
疾患マスタ（部位別 JSON）＋共有リソース：
- `treatment_master.json` … 11機序（末梢/脊髄/脳）
- `track_to_mechanism.json` … treatment_track → 機序の resolver 対応表
- `dermatome_map.json` / `peripheral_nerve_map.json` … 神経根デルマトーム・末梢神経支配
- `test_methods.json` … 徒手検査の実施方法
- `karte_schema.json` / `intake_flow.json` / `tcm_findings.json` … カルテ/問診/東洋医学所見スキーマ
- `stimulus_modulation.json` / `electrotherapy_params.json` … 刺激量・鍼通電パラメータ（臨床経験ベース）

### エビデンスの別格扱い
疾患鑑別（findings の LR/Rank）は文献ベース。刺激量・鍼通電パラメータは**著者の臨床経験ベース（エビデンスなし）**であり、UI 上でも明記して区別している。

## エンジンの要点
- **Rank 優先集計**（LR は補助）。LR が無い所見でも Rank で集計。
- **severity**：🔴緊急→遮断 / 🟡要注意→警告つき通過。`severity_conditional`・腹膜刺激/血管オーバーライド対応。
- **正規化層**：branch 配列・複数所属・絵文字 severity・記述的 treatment_track を内部正準形へ吸収（部位ごとにスキーマが多少違っても同一エンジンで動く）。
- 重要：severity（警告）と treatment_track（カード種別）は分離。

## 開発・デプロイ
- ローカル確認：`npx serve .`（任意ポート）
- デプロイ：`main` を push → GitHub Pages（Settings → Pages → Deploy from a branch）
- Service Worker のキャッシュ版は `sw.js` の `CACHE` を更新。更新が見えない時はハードリロード（Ctrl+Shift+R）。

## 免責
本ツールは教育・研究目的の補助であり、医療行為・診断を置き換えるものではない。
