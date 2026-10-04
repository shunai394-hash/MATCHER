# MATCHER 本番投入 Runbook（migration 006〜009 / 初回データ）

対象: Supabase project `bihnncycujxifczvhfhr`（ap-northeast-1）。
この手順書の SQL・スクリプトはすべてローカル Postgres 16 と GitHub CI（`npm run verify:migrations`, `npm run test:e2e`）で検証済み。
**本番 DB に対しては一度も実行されていない。** 本番 schema のうち、オーナー申告の 5 テーブル
（supplier_product / supplier_offer / supplier_offer_snapshot / supplier_offer_freshness / identity_match）以外は推定である。

---

## 1. migration 監査結果

適用方法は必ず `psql "$PROD_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f <file>`。
1 ファイル = 1 トランザクションなので、途中で止まった場合は何も変更されない（CI で検証済み）。

### 006_live_schema_alignment.sql

| 項目 | 内容 |
|---|---|
| 変更内容 | supplier_product に product_name / manufacturer / color / size / capacity / generation / set_count / condition / first_seen_at / last_seen_at を **無ければ追加**。supplier_offer.updated_at、supplier_offer_freshness.updated_at を無ければ追加。supplier_offer_snapshot・identity_match・quality_patrol_run・quality_diagnosis を無ければ作成。match_result があり identity_match が無い場合のみ RENAME。CHECK `supplier_product_set_count_check` を無ければ追加。ガードトリガ `identity_match_hard_block_guard` を作り直し、関数 `prevent_auto_link_hard_block` を CREATE OR REPLACE。インデックス追加。4 テーブルの RLS を ON |
| DROP | 旧列（supplier_product.title / fetched_at / source_updated_at、supplier_offer.cost / shipping_cost / inventory / shipping_verified / observed_at）のみ。**値が 1 件でもあれば例外で停止し何も変更しない**。全行 NULL（shipping_verified は全行 false）の列だけ DROP。自動統合・自動コピーは行わない |
| UPDATE | `supplier_offer_freshness.updated_at = checked_at` のみ。updated_at 列を **この実行で新規作成した場合だけ** 実行（再適用で巻き戻らない） |
| 既存データへの影響 | 申告どおりの本番形状では **実質 no-op**（ローカルの本番形状スナップショットで「006 applied=true」を事前確認）。データの削除・書換えなし |
| 既存コードへの影響 | 列追加のみ。RLS を ON にすると、anon / authenticated キーでこれら 4 テーブルを読む別アプリがあれば読めなくなる（MATCHER は service role なので影響なし） |
| 二重適用 | すべて IF NOT EXISTS / 存在チェック付き。2 回適用で同一構造（CI 検証済み） |
| 重複データ | 影響なし |
| NULL データ | set_count が NULL は許容。`set_count <= 0` の行があると CHECK 追加で停止（何も変更されない） |
| ロック | ALTER TABLE ADD COLUMN（デフォルト now() は書換えなし）、CREATE INDEX（非 CONCURRENT。対象テーブルへの書込みを作成中ブロック） |
| rollback | `db/ops/rollback/006_rollback.md`（preflight で「無かった」と記録したものだけを戻す） |

### 007_master_product_candidates.sql

| 項目 | 内容 |
|---|---|
| 変更内容 | master_product に approval_status（既定 'APPROVED'）, origin（既定 'MANUAL'）, origin_supplier_product_id（FK → supplier_product, ON DELETE SET NULL）, reviewed_at, reviewed_by を追加。CHECK 3 つ、インデックス 2 つ（うち partial UNIQUE 1 つ） |
| enum 変更 | **なし**（product_status は変更しない。候補は status='INACTIVE' で表現） |
| 既存データへの影響 | 既存マスタはすべて APPROVED / MANUAL になる。status は変更しない（INACTIVE のものは INACTIVE のまま） |
| CHECK | `status <> 'ACTIVE' or approval_status = 'APPROVED'` — 既存行は全て APPROVED なので必ず通る |
| UNIQUE | origin_supplier_product_id は新列で全行 NULL → 衝突なし |
| 既存コードへの影響 | 旧コードの INSERT は既定値で通る |
| 二重適用 | IF NOT EXISTS。同名制約が別テーブルにある場合は作成をスキップ（preflight が検出） |
| rollback | `db/ops/rollback/007_rollback.sql`（候補・レビュー済みマスタが 1 件でもあれば停止） |

### 008_purchase_review_requester.sql

| 項目 | 内容 |
|---|---|
| 変更内容 | purchase_review に requested_by_user_id, requested_by_email, verified_terms（既定 '{}'）を追加 |
| 前提 | purchase_review が存在すること（無ければ停止。preflight が STOP 表示） |
| 既存データ / コード | 影響なし |
| rollback | `db/ops/rollback/008_rollback.sql`（申請者データがあれば停止） |

### 009_supplier_offer_one_per_currency.sql

| 項目 | 内容 |
|---|---|
| 変更内容 | UNIQUE INDEX (supplier_product_id, currency) |
| 重複データ | 1 組でもあれば **例外で停止**。自動統合・削除はしない（手動判断） |
| 注意 | 大文字小文字・空白違い（'JPY' と 'jpy'）は重複とみなされない。ingest は大文字で書くので、小文字の旧行は再利用されず別オファーが作られる → preflight が REVIEW 表示 |
| NULL | currency は NOT NULL 前提。NULL がある場合 preflight が REVIEW 表示（UNIQUE では NULL 同士は重複扱いにならない） |
| rollback | `db/ops/rollback/009_rollback.sql`（インデックス削除のみ） |

---

## 2. 推定で実装している箇所（本番 schema 確認が必要）

| 対象 | 推定内容 | 確認方法 | 影響 |
|---|---|---|---|
| freshness_policy のキー列 | migration 履歴（002）は `metric`、旧コードは `data_type`。**どちらか未確認** | preflight「freshness_policy key column」 | コードは両方読める（`select *`）。PRICE / INVENTORY / SHIPPING 行が無いと全オファーが BLOCKED（安全側） |
| freshness_policy の値 | PRICE 86400 / INVENTORY 21600 / SHIPPING 604800 秒（002 の初期値） | preflight「freshness_policy row」 | 本番値が違えば鮮度判定が変わる |
| quality_patrol_run | id, status(RUNNING/PASSED/FAILED), summary jsonb, started_at, finished_at | preflight の columns / check | 列や CHECK が違うと品質パトロールが 500（データは壊れない） |
| quality_diagnosis | id, patrol_run_id(FK), severity(INFO/WARN/ERROR), code, details jsonb, created_at | 同上 | 同上 |
| quality_gate_result / profit_snapshot / ingestion_run / quality_run | 001 の定義どおり | preflight の columns | 列違いは ingest / recompute が 500 で停止 |
| market_price_observation | 005 の定義（currency 列なし → JPY とみなす） | preflight の columns | currency 列がある場合はその値を使う |
| master_product / product_identifier / product_variant / suppliers / supplier_product_identifier / purchase_review | 001〜004 の定義 | preflight の columns | — |
| identity_hard_block / supplier_offer_observation / match_evidence | 002 で作られるがアプリは未使用 | preflight（INFO） | なし |
| RLS / policy | 全テーブル RLS ON・policy なし（001 の方針） | preflight の rls / policies | 006 が RLS を ON にする 4 テーブル |

---

## 3. 公開 API の判断材料（コード未変更）

| API | 認証なしで得られるもの | リスク |
|---|---|---|
| `GET /api/opportunities` | 仕入先名・SKU・仕入先 URL・仕入価格・送料・販売相場・手数料・想定利益・在庫・鮮度 | **仕入れノウハウ（どこで何をいくらで買うと儲かるか）がそのまま第三者に読まれる**。競合に真似される。1 リクエストで identity_match 最大 1 万行＋オファー毎のクエリ → 連打で DB 負荷（DoS） |
| `POST /api/decision` | 任意の JAN / 型番で、マスタ照合結果（マスタの識別子を含む根拠）、salePrice を付ければ利益計算と **purchase.amount（仕入価格＋送料）と supplierOfferId** | JAN を総当たりすれば仕入原価を抜き取れる。1 リクエストでマスタ最大 5000 件＋識別子＋バリアントを読む → DoS |

判断材料:
- README の方針は「server-side / internal」、DB は anon policy なし。**社内の仕入れ判断ツール**として設計されている。
- 購入・承認系はすでにログイン必須。閲覧系だけが公開されている状態は方針と不整合。
- 公開する価値（集客・SEO 等）は現仕様に無い。

→ 現在の仕様には **「ログイン必須」** が適している（`requireUserRole(request, "purchaser")` を 2 API に追加し、`/opportunities` `/console` 画面はログイン後に取得する変更が必要）。本番に実データを入れる前に決定すること。

---

## 4. 本番投入手順（各段階の停止条件つき）

事前準備: `PROD_DB_URL` = Supabase の **Direct connection（Session）** 文字列。psql / pg_dump は本番 Postgres と同じかそれ以上のメジャーバージョン。
作業中は Vercel の本番デプロイを **行わない**（新コードは 007 の列が無いと動かない。旧コードは 006〜009 適用後もそのまま動く）。

| # | 作業 | コマンド | 停止条件（1 つでも該当したら中止し、何もしない） |
|---|---|---|---|
| 1 | DB backup | ダッシュボード Database → Backups で直近バックアップ / PITR の時刻を記録。加えて `pg_dump "$PROD_DB_URL" -Fc -n public -f matcher-$(date +%Y%m%d%H%M).dump` | dump が失敗、またはファイルサイズ 0 |
| 2 | schema 確認 | `psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f db/ops/preflight.sql > preflight.log 2>&1` と `-f db/ops/migration_status.sql` | `PREFLIGHT \| STOP` が 1 行でもある / REVIEW を人が確認していない / スクリプト自体がエラー。**preflight.log は保存**（rollback と本番 schema の記録に使う） |
| 3 | 006 適用 | `psql "$PROD_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f db/migrations/006_live_schema_alignment.sql` | ERROR（何も変更されていない）。特に `MATCHER 006 stopped` は旧列にデータあり → 手動判断 |
| 4 | 検証 | `migration_status.sql` で 006 applied=t。preflight を再実行し件数（rows）が手順 2 と同じ | 006=f、行数の変化 |
| 5 | 007 適用 | 同様に 007 | ERROR |
| 6 | 検証 | 007 applied=t。`select approval_status, status, count(*) from master_product group by 1,2;` で全行 APPROVED・status は手順 2 と同じ | 想定外の組合せ |
| 7 | 008 適用 | 同様に 008 | ERROR（purchase_review が無い等） |
| 8 | 検証 | 008 applied=t | 008=f |
| 9 | 009 適用 | 同様に 009 | `duplicate supplier_offer rows` → 重複を人が解消するまで中止（自動統合しない） |
| 10 | migration status | `migration_status.sql` で 006〜009 すべて applied=t, missing_markers=0 | 1 つでも f |
| — | アプリ設定 | Vercel 環境変数: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `MATCHER_INGEST_TOKEN`, `CRON_SECRET`, `MATCHER_REVIEW_TOKEN`, `MATCHER_PURCHASER_EMAILS`, `MATCHER_ADMIN_EMAILS`。Stripe は最初は未設定、または `sk_test_` のみ。GitHub CI が緑のコミットだけを **1 回だけ** デプロイ（rate limit 中は再試行しない） | デプロイ失敗 → 連打せず原因確認 |
| 11 | ingest test | 「5. 初回 1 商品テスト」のステップ A | HTTP 200 以外、`ok:false` |
| 12 | recompute test | `curl -X POST -H "x-matcher-ingest-token: $TOKEN" $APP/api/opportunities/recompute` | 500、identity.written が想定外に多い |
| 13 | opportunity test | `curl $APP/api/opportunities`（ログイン必須化後は Bearer 付き） | 承認前の商品が出る、`excluded` が説明できない |
| 14 | purchase review test | Stripe 未設定なら購入担当ログインで「仕入れ申請」→ `STRIPE_SERVER_CONFIG_MISSING`、purchase_review が FAILED・requested_by_email 記録を確認。Stripe テストキーなら仮押さえ→`/review` で却下（capture しない） | 認証なしで通る / 再確認なしで Stripe に到達 / 本番キーでの課金 |

rollback（逆順、必要な場合のみ）: `db/ops/rollback/009_rollback.sql` → `008` → `007`（いずれも `--single-transaction`、データがあれば自ら停止）→ 006 は `006_rollback.md`。

---

## 5. 本番データ投入後の最初のテスト（1 商品だけ）

**実在の商品・実際に確認した仕入価格／送料／在庫／販売相場だけを使う。** 架空値を入れると本物の「儲かる候補」として表示されてしまう。

A. 仕入先データ（ingest。recompute は自動実行）
```bash
curl -sS -X POST "$APP/api/ingest" -H "content-type: application/json" -H "x-matcher-ingest-token: $MATCHER_INGEST_TOKEN" -d '{
  "source": "first-production-test",
  "supplierItems": [{
    "supplierKey": "<仕入先キー>", "supplierName": "<仕入先名>", "supplierProductId": "<仕入先の商品ID>",
    "productName": "<商品名>", "brand": "<ブランド>", "modelNumber": "<型番>",
    "identifiers": [{ "type": "JAN", "value": "<実際のJAN>" }],
    "cost": <実際の仕入価格>, "shippingCost": <実際の送料>, "inventory": <実際の在庫>, "orderability": "ORDERABLE",
    "currency": "JPY", "sourceUrl": "<仕入先URL>"
  }]
}'
```
B. 経路確認（読み取り専用）
```bash
psql "$PROD_DB_URL" -X -v supplier_key=<仕入先キー> -v supplier_product_id=<仕入先の商品ID> -f db/ops/trace_supplier_product.sql
```
期待値（段階ごと。違えばそこで止める）:
1. supplier_product: 1 行、product_name が入っている
2. supplier_offer: currency ごとに 1 行、ORDERABLE
3. snapshot: 仕入価格・送料・在庫・shipping_confidence=1
4. freshness: price / inventory / shipping の observed_at が今
5. master_product: 既存マスタに JAN が無ければ **CANDIDATE / INACTIVE / SUPPLIER_CANDIDATE** の候補が 1 件
6. identity_match: **REVIEW**（候補へのリンク）。AUTO_LINK になっていたら停止
7. 販売相場を登録（候補マスタ ID を使う）:
   `{"source":"first-production-test","marketObservations":[{"masterProductId":"<候補ID>","source":"<販売先>","salePrice":<実売価格>,"paymentFee":<>,"marketplaceFee":<>,"tax":<>,"otherCost":<>,"sourceUrl":"<URL>"}]}`
8. profit_snapshot: 期待利益 = 販売価格 − 仕入 − 送料 − 決済 − モール − 税 − その他 と一致、cost_complete=true
9. quality_gate_result: **BLOCKED**（IDENTITY_NOT_AUTO_LINKED / MASTER_NOT_APPROVED）。この時点で `/api/opportunities` に出ないこと
10. `/review` で候補マスタの識別子・商品名を人が確認して承認 → trace で identity_match が AUTO_LINK、gate が SELLABLE（利益 > 0、在庫 > 0、鮮度内の場合のみ）
11. `/api/opportunities` に 1 件だけ出て、同一商品の根拠・在庫・仕入価格・送料・販売価格・手数料・鮮度・利益・品質ゲートが表示されること

テスト商品を候補から外したい場合は削除せず、同じ商品を `"orderability": "BLOCKED"` で再 ingest する（データは残り、Opportunity から消える）。

---

## 6. Opportunity の表示条件（コードで強制済み・E2E 検証済み）

データが無い間は「今は「儲かる」と言える実データがありません。」とだけ表示する。次の **すべて** を実データで満たしたオファーだけが Opportunity になる:
同一商品（最新 identity_match が AUTO_LINK・hard_block なし・承認済み ACTIVE マスタ）／ORDERABLE／在庫 > 0／仕入価格あり／送料あり（確度 > 0）／販売価格あり（鮮度内）／手数料・税・その他すべて既知／価格・在庫・送料の鮮度が freshness_policy 内／期待利益 > 0（かつ最低利益以上）／最新 quality_gate_result が SELLABLE で入力より新しい。
