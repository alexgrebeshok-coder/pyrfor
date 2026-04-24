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
export function readJsonFile(filename, defaultValue) {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) {
        writeJsonFile(filename, defaultValue);
        return defaultValue;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    }
    catch (error) {
        console.error(`Error reading ${filename}:`, error);
        return defaultValue;
    }
}
/**
 * Write JSON file
 */
export function writeJsonFile(filename, data) {
    const filePath = path.join(DATA_DIR, filename);
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
    catch (error) {
        console.error(`Error writing ${filename}:`, error);
    }
}
/**
 * Append to JSON array file
 */
export function appendToJsonArray(filename, item) {
    const data = readJsonFile(filename, []);
    data.push(item);
    writeJsonFile(filename, data);
    return item;
}
/**
 * Update item in JSON array
 */
export function updateInJsonArray(filename, predicate, updater) {
    const data = readJsonFile(filename, []);
    const index = data.findIndex(predicate);
    if (index === -1)
        return null;
    data[index] = updater(data[index]);
    writeJsonFile(filename, data);
    return data[index];
}
/**
 * Delete item from JSON array
 */
export function deleteFromJsonArray(filename, predicate) {
    const data = readJsonFile(filename, []);
    const initialLength = data.length;
    const filtered = data.filter((item) => !predicate(item));
    if (filtered.length === initialLength)
        return false;
    writeJsonFile(filename, filtered);
    return true;
}
/**
 * Find item in JSON array
 */
export function findInJsonArray(filename, predicate) {
    const data = readJsonFile(filename, []);
    return data.find(predicate) || null;
}
/**
 * Query JSON array with filters
 */
export function queryJsonArray(filename, options) {
    let data = readJsonFile(filename, []);
    if (options === null || options === void 0 ? void 0 : options.filter) {
        data = data.filter(options.filter);
    }
    if (options === null || options === void 0 ? void 0 : options.sort) {
        data = data.sort(options.sort);
    }
    if (options === null || options === void 0 ? void 0 : options.offset) {
        data = data.slice(options.offset);
    }
    if (options === null || options === void 0 ? void 0 : options.limit) {
        data = data.slice(0, options.limit);
    }
    return data;
}
