# 痛み鑑別 PWA

鍼灸臨床向けの痛み鑑別支援ツール。バニラ HTML/CSS/JS（フレームワークなし）・PWA・GitHub Pages デプロイ前提。
**確定診断ではなく「示唆」を提示**し、最終判断は医療者が行う前提の補助ツール。

## 画面
- **鑑別（index.html）** … 部位選択 → ①レッドフラッグ ②局所/放散などの分岐 ③動き ④徒手検査(Rank集計) ⑤高位診断 ⑥治療トラック の固定フロー。結果を localStorage に保存しカルテへ受け渡し。
- **問診（intake.html）** … 早見表 Step1/2/4/5/6 を質問化。回答からカルテ欄（急性慢性・予想組織・レッド/イエローフラッグ・痛みレベル）を自動導出。Step3 は鑑別エンジンへ。
- **東洋弁証（mos.html）** … MOS（51問の加点式）で11軸の弁証プロファイルを算出 → 全証を横断スコアで**得点降順の候補リスト**に展開。各証の**相違点**チェックで加点・再ランク（デバウンス）し、最有力の**選穴例（acupoints参照）＋手技**を表示。確定証は `mos_bianzheng_result` に保存しカルテへ受け渡し。
- **カルテ（karte.html）** … スキーマ駆動のフォーム。鑑別/問診/東洋弁証の結果を自動流し込み（証・選穴・手技のカード含む）、治療プラン（機序・鍼通電パラメータ）も resolver で提案。複数保存／呼び出し／JSON書き出し読み込み／印刷。

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
- `mos_questions.json` / `mos_scoring.json` … MOS 51問と11軸スコア式
- `tcm_bianzheng.json` … 証候マスタ（9グループ・44証。MOS軸→証候グループ対応、相違点・選穴・手技）
- `acupoints.json` … 経穴マスタ（読み・経絡・WHOコード）。証候/西洋治療マスタからツボ名で参照する共有リソース

> 証候の選穴は `acupoints.json` をツボ名で参照（証をまたぐ重複を二重管理しない）。整合は `node validate.js` で検査できる。

### エビデンスの別格扱い
疾患鑑別（findings の LR/Rank）は文献ベース。刺激量・鍼通電パラメータは**著者の臨床経験ベース（エビデンスなし）**であり、UI 上でも明記して区別している。

## エンジンの要点
- **Rank 優先集計**（LR は補助）。LR が無い所見でも Rank で集計。
- **severity**：🔴緊急→遮断 / 🟡要注意→警告つき通過。`severity_conditional`・腹膜刺激/血管オーバーライド対応。
- **正規化層**：branch 配列・複数所属・絵文字 severity・記述的 treatment_track を内部正準形へ吸収（部位ごとにスキーマが多少違っても同一エンジンで動く）。
- 重要：severity（警告）と treatment_track（カード種別）は分離。

## 開発・デプロイ
- ローカル確認：`npx serve .`（任意ポート）
- データ整合チェック：`node validate.js`（選穴↔経穴の未登録、resolver機序id、branch解決、JSON妥当性などを検査。エラーで終了コード1）。データ追加後に実行推奨。
- デプロイ：`master` を push → GitHub Pages（Settings → Pages → Deploy from a branch）。リポジトリは [atsuya2501/The-interview](https://github.com/atsuya2501/The-interview)。
- Service Worker は **network-first**（`sw.js`）。オンラインなら通常リロード1回で最新が反映され、オフライン時のみキャッシュで動作。`CACHE` 版はオフラインキャッシュを確実に入れ替えたい時に更新する（通常更新では必須ではない）。

## 免責
本ツールは教育・研究目的の補助であり、医療行為・診断を置き換えるものではない。
