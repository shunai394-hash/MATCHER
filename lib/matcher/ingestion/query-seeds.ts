export const DEFAULT_DISCOVERY_QUERIES = [
  "Apple AirPods",
  "Nintendo Switch",
  "PlayStation 5",
  "Anker モバイルバッテリー",
  "Logicool マウス",
  "SanDisk SSD",
  "Bose イヤホン",
  "Canon インク",
  "SONY ヘッドホン",
  "LEGO",
] as const;

export function discoveryQueries(input?: string) {
  const raw = input?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...new Set(raw.length ? raw : DEFAULT_DISCOVERY_QUERIES)];
}
