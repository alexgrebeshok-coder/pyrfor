#!/usr/bin/env node
/**
 * i18n key completeness validator.
 *
 * Checks that every translation key present in any locale (ru, en, zh) is
 * present in ALL locales. Exits with code 1 if missing keys are found.
 *
 * Usage: node scripts/check-i18n.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const translationsPath = resolve(__dirname, "..", "lib", "translations.ts");
const source = readFileSync(translationsPath, "utf-8");

// Extract the messages object by finding locale blocks and their keys.
// Each locale block looks like:  "key.name": "...",
function extractKeys(localeLabel) {
  // Find the locale section inside `messages`
  const localePattern = new RegExp(
    `^\\s+${localeLabel}:\\s*\\{`,
    "m"
  );
  const match = localePattern.exec(source);
  if (!match) {
    console.error(`Could not find locale "${localeLabel}" in messages.`);
    process.exit(2);
  }

  const startIdx = match.index + match[0].length;
  let depth = 1;
  let i = startIdx;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }

  const block = source.slice(startIdx, i - 1);
  const keys = [];
  // Match quoted keys at the top level of the block
  for (const m of block.matchAll(/^\s+"([^"]+)":/gm)) {
    keys.push(m[1]);
  }
  return new Set(keys);
}

const locales = ["ru", "en", "zh"];
const keySets = {};
for (const loc of locales) {
  keySets[loc] = extractKeys(loc);
}

// Union of all keys
const allKeys = new Set();
for (const loc of locales) {
  for (const key of keySets[loc]) {
    allKeys.add(key);
  }
}

let hasMissing = false;
const missingByLocale = {};

for (const key of [...allKeys].sort()) {
  for (const loc of locales) {
    if (!keySets[loc].has(key)) {
      hasMissing = true;
      if (!missingByLocale[loc]) missingByLocale[loc] = [];
      missingByLocale[loc].push(key);
    }
  }
}

console.log(`i18n check: ${allKeys.size} unique keys across ${locales.length} locales`);
for (const loc of locales) {
  console.log(`  ${loc}: ${keySets[loc].size} keys`);
}

if (hasMissing) {
  console.log("\n❌ Missing translations:");
  for (const loc of locales) {
    if (missingByLocale[loc]?.length) {
      console.log(`\n  ${loc} is missing ${missingByLocale[loc].length} keys:`);
      for (const key of missingByLocale[loc]) {
        console.log(`    - ${key}`);
      }
    }
  }
  process.exit(1);
} else {
  console.log("\n✅ All locales have complete translations.");
  process.exit(0);
}
