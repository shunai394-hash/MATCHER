import type { SourceProduct } from "./types";

const SWITCH_2 = /nintendo\s*switch\s*2|switch\s*2|switch2|スイッチ\s*2/i;
const MAIN_UNIT_QUERY = /本体|本機|console|main\s*unit/i;
const SWITCH_2_MAIN_UNIT = /本体|本機|console|main\s*unit/i;
const SWITCH_2_CONSOLE = /本体|国内版|日本語版|マリオカート.{0,12}セット|スプラトゥーン.{0,12}セット|BEE-S-KB6/i;
const SWITCH_2_LEGACY_MODEL = /有機ELモデル|従来スイッチ|HEG-S-|HAC-S-/i;
const CONDITION_FLAGS = /ジャンク|訳あり|動作未確認|動作不良|箱イタミ|破損|部品取り/i;
const CONDITION_INTENT = /中古|ジャンク|訳あり|動作未確認|箱イタミ|破損|部品取り/i;

const PRODUCT_GROUPS = [
  { key: "battery", query: /モバイルバッテリー|power\s*bank|portable\s*battery/i, title: /モバイルバッテリー|power\s*bank|portable\s*battery/i },
  { key: "charger", query: /充電器|acアダプター|usb.?c充電器|charger|power\s*adapter/i, title: /充電器|acアダプター|usb.?c充電器|charger|power\s*adapter/i },
  { key: "case", query: /ケース|カバー|保護フィルム|ガラスフィルム|case|cover|screen\s*protector/i, title: /ケース|カバー|保護フィルム|ガラスフィルム|case|cover|screen\s*protector/i },
  { key: "controller", query: /コントローラー|joy.?con|ジョイコン|ホリパッド|controller|gamepad/i, title: /コントローラー|joy.?con|ジョイコン|ホリパッド|controller|gamepad/i },
  { key: "storage", query: /micro\s?sd|sdカード|メモリーカード|memory\s*card/i, title: /micro\s?sd|sdカード|メモリーカード|memory\s*card/i },
  { key: "software", query: /ソフト|ゲームソフト|ゲーム|amiibo|game\s*software|video\s*game/i, title: /ソフト|ゲームソフト|ゲーム|amiibo|game\s*software|video\s*game/i },
  { key: "router", query: /ルーター|router|wifi\s*router/i, title: /ルーター|router|wifi\s*router/i },
  { key: "headphones", query: /イヤホン|ヘッドホン|ヘッドセット|earbuds|headphones|headset/i, title: /イヤホン|ヘッドホン|ヘッドセット|earbuds|headphones|headset/i },
  { key: "lego", query: /lego|レゴ/i, title: /lego|レゴ/i },
] as const;

const ACCESSORY_GROUPS = new Set(["charger", "case", "controller", "storage", "software"]);
const MAIN_PRODUCT_MARKER = /本体|モバイルバッテリー|power\s*bank|充電器|charger|ルーター|router|イヤホン|ヘッドホン|headphones|lego|レゴ|ノートpc|laptop|スマートフォン|iphone|android/i;

export type RelevanceDecision = { relevant: boolean; reason: string | null };

function groupFor(value: string, field: "query" | "title") {
  return PRODUCT_GROUPS.find((group) => group[field].test(value))?.key ?? null;
}

export function classifyProductRelevance(query: string, product: Pick<SourceProduct, "productName">): RelevanceDecision {
  const normalizedQuery = query.trim();
  const title = product.productName ?? "";
  const queryGroup = groupFor(normalizedQuery, "query");
  const titleGroup = groupFor(title, "title");
  const asksForSwitch2MainUnit = MAIN_UNIT_QUERY.test(normalizedQuery) && SWITCH_2.test(normalizedQuery);

  if (asksForSwitch2MainUnit) {
    if (SWITCH_2_LEGACY_MODEL.test(title)) return { relevant: false, reason: "MODEL_OR_VARIANT_MISMATCH" };
    if (!SWITCH_2.test(title) || !SWITCH_2_CONSOLE.test(title)) return { relevant: false, reason: "NOT_A_SWITCH_2_MAIN_UNIT" };
    if (/本体のみ|付属品なし|付属品ありません|ジャンク|訳あり|動作未確認/i.test(title)) {
      return { relevant: false, reason: "INCOMPLETE_OR_UNVERIFIED_CONDITION" };
    }
  }

  if (queryGroup && titleGroup && queryGroup !== titleGroup) {
    return { relevant: false, reason: "CATEGORY_MISMATCH" };
  }

  if (!queryGroup && !normalizedQuery && titleGroup && ACCESSORY_GROUPS.has(titleGroup) && !MAIN_PRODUCT_MARKER.test(title)) {
    return { relevant: false, reason: "ACCESSORY_OR_SOFTWARE" };
  }

  if (CONDITION_FLAGS.test(title) && !CONDITION_INTENT.test(normalizedQuery)) {
    return { relevant: false, reason: "CONDITION_NOT_REQUESTED" };
  }

  return { relevant: true, reason: null };
}

export function filterRelevantProducts(query: string, products: SourceProduct[]): SourceProduct[] {
  return products.filter((product) => classifyProductRelevance(query, product).relevant);
}

export function filterRelevantProductsWithReasons(query: string, products: SourceProduct[]) {
  const included: SourceProduct[] = [];
  const excluded: Array<{ product: SourceProduct; reason: string }> = [];
  for (const product of products) {
    const decision = classifyProductRelevance(query, product);
    if (decision.relevant) included.push(product);
    else excluded.push({ product, reason: decision.reason ?? "NOT_RELEVANT" });
  }
  return { included, excluded };
}
