import type { SourceProduct } from "./types";

const ACCESSORY_OR_SOFTWARE = /ケース|カバー|保護フィルム|ガラスフィルム|acアダプター|アダプター|充電器|コントローラー|ホリパッド|micro\\s?sd|sdカード|収納バッグ|キャリング|スタンド|ソフト|ゲーム|amiibo|ハンドル|ケーブル|joy[-\\s]?con|ジョイコン|ドック/i;
const SWITCH_2 = /nintendo\\s*switch\\s*2|switch\\s*2|switch2|スイッチ\\s*2/i;

// Narrow only explicit "main unit" searches. Keep all source records persisted,
// but don't present accessories/software as if they were the requested console.
export function filterRelevantProducts(query: string, products: SourceProduct[]): SourceProduct[] {
  const asksForSwitch2MainUnit =
    /本体|本機|console/i.test(query) && SWITCH_2.test(query);
  if (!asksForSwitch2MainUnit) return products;

  return products.filter((product) =>
    SWITCH_2.test(product.productName) && !ACCESSORY_OR_SOFTWARE.test(product.productName),
  );
}
