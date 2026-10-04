import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Static audit: every Supabase table / column referenced in app code must exist in
 * db/schema.sql (which mirrors the live Supabase schema). Catches regressions such as
 * `.from("match_result")` or `supplier_offer.cost` before they reach production.
 */

const schemaFile = process.env.SCHEMA_FILE ?? "db/schema.sql";
const schema = readFileSync(schemaFile, "utf8");
const tables = new Map<string, Set<string>>();
// Accepts both hand-written DDL and pg_dump output ("CREATE TABLE public.x (").
for (const match of schema.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+) \(([\s\S]*?)\n\);/gi)) {
  const columns = new Set<string>();
  for (const line of match[2].split("\n")) {
    const col = line.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+/);
    if (col && !["unique", "primary", "constraint", "check", "foreign"].includes(col[1])) columns.add(col[1]);
  }
  tables.set(match[1], columns);
}
assert.ok(tables.size > 10, `schema parse failed (${schemaFile})`);
assert.ok(!tables.has("match_result"), "match_result must not exist (live DB uses identity_match)");

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !path.startsWith("scripts")) out.push(path);
  }
  return out;
}

const problems: string[] = [];
let references = 0;
for (const file of [...walk("app"), ...walk("lib")]) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\.from\("([a-z_]+)"\)([\s\S]{0,700}?)(?:;|\n\s*\n)/g)) {
    const table = match[1];
    references += 1;
    const columns = tables.get(table);
    if (!columns) {
      problems.push(`${file}: unknown table "${table}"`);
      continue;
    }
    const chain = match[2];
    const check = (column: string, how: string) => {
      if (!columns.has(column)) problems.push(`${file}: ${table}.${column} does not exist (${how})`);
    };
    const select = chain.match(/\.select\("([^"]*)"/);
    if (select && select[1] !== "*") for (const col of select[1].split(",").map((c) => c.trim()).filter(Boolean)) check(col, "select");
    for (const m of chain.matchAll(/\.(eq|neq|in|order|gt|gte|lt|lte|not|is)\("([a-z_]+)"/g)) check(m[2], m[1]);
    const conflict = chain.match(/onConflict: "([^"]+)"/);
    if (conflict) for (const col of conflict[1].split(",")) check(col.trim(), "onConflict");
  }
  // Generic helpers take the table and column list as string arguments.
  for (const m of source.matchAll(/selectIn<[^>]*>\(\s*db,\s*"([a-z_]+)",\s*"([^"]+)",\s*"([a-z_]+)"/g)) {
    references += 1;
    const columns = tables.get(m[1]);
    if (!columns) { problems.push(`${file}: unknown table "${m[1]}"`); continue; }
    if (m[2] !== "*") for (const col of m[2].split(",")) if (!columns.has(col.trim())) problems.push(`${file}: ${m[1]}.${col.trim()} does not exist (selectIn)`);
    if (!columns.has(m[3])) problems.push(`${file}: ${m[1]}.${m[3]} does not exist (selectIn filter)`);
  }
  for (const banned of ["match_result", "supplier_offer_observation"]) {
    if (source.includes(`"${banned}"`)) problems.push(`${file}: references removed table ${banned}`);
  }
}

assert.deepEqual(problems, [], "\n" + problems.join("\n"));
console.log(`MATCHER schema usage audit: PASS (${references} table references checked against ${schemaFile})`);
