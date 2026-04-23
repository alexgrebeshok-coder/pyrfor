/**
 * File Manager - Simple file-based storage for CEOClaw
 * Works out of the box, no database required
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Read JSON file
 */
export function readJsonFile<T>(filename: string, defaultValue: T): T {
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    writeJsonFile(filename, defaultValue);
    return defaultValue;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
    return defaultValue;
  }
}

/**
 * Write JSON file
 */
export function writeJsonFile<T>(filename: string, data: T): void {
  const filePath = path.join(DATA_DIR, filename);

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
  }
}

/**
 * Append to JSON array file
 */
export function appendToJsonArray<T>(filename: string, item: T): T {
  const data = readJsonFile<T[]>(filename, []);
  data.push(item);
  writeJsonFile(filename, data);
  return item;
}

/**
 * Update item in JSON array
 */
export function updateInJsonArray<T>(
  filename: string,
  predicate: (item: T) => boolean,
  updater: (item: T) => T
): T | null {
  const data = readJsonFile<T[]>(filename, []);
  const index = data.findIndex(predicate);

  if (index === -1) return null;

  data[index] = updater(data[index]);
  writeJsonFile(filename, data);
  return data[index];
}

/**
 * Delete item from JSON array
 */
export function deleteFromJsonArray<T>(
  filename: string,
  predicate: (item: T) => boolean
): boolean {
  const data = readJsonFile<T[]>(filename, []);
  const initialLength = data.length;
  const filtered = data.filter((item) => !predicate(item));

  if (filtered.length === initialLength) return false;

  writeJsonFile(filename, filtered);
  return true;
}

/**
 * Find item in JSON array
 */
export function findInJsonArray<T>(
  filename: string,
  predicate: (item: T) => boolean
): T | null {
  const data = readJsonFile<T[]>(filename, []);
  return data.find(predicate) || null;
}

/**
 * Query JSON array with filters
 */
export function queryJsonArray<T>(
  filename: string,
  options?: {
    filter?: (item: T) => boolean;
    sort?: (a: T, b: T) => number;
    limit?: number;
    offset?: number;
  }
): T[] {
  let data = readJsonFile<T[]>(filename, []);

  if (options?.filter) {
    data = data.filter(options.filter);
  }

  if (options?.sort) {
    data = data.sort(options.sort);
  }

  if (options?.offset) {
    data = data.slice(options.offset);
  }

  if (options?.limit) {
    data = data.slice(0, options.limit);
  }

  return data;
}
