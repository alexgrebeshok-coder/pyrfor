"use strict";
/**
 * File Manager - Simple file-based storage for CEOClaw
 * Works out of the box, no database required
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJsonFile = readJsonFile;
exports.writeJsonFile = writeJsonFile;
exports.appendToJsonArray = appendToJsonArray;
exports.updateInJsonArray = updateInJsonArray;
exports.deleteFromJsonArray = deleteFromJsonArray;
exports.findInJsonArray = findInJsonArray;
exports.queryJsonArray = queryJsonArray;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.join(process.cwd(), 'data');
// Ensure data directory exists
if (!fs_1.default.existsSync(DATA_DIR)) {
    fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
}
/**
 * Read JSON file
 */
function readJsonFile(filename, defaultValue) {
    const filePath = path_1.default.join(DATA_DIR, filename);
    if (!fs_1.default.existsSync(filePath)) {
        writeJsonFile(filename, defaultValue);
        return defaultValue;
    }
    try {
        const content = fs_1.default.readFileSync(filePath, 'utf-8');
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
function writeJsonFile(filename, data) {
    const filePath = path_1.default.join(DATA_DIR, filename);
    try {
        fs_1.default.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
    catch (error) {
        console.error(`Error writing ${filename}:`, error);
    }
}
/**
 * Append to JSON array file
 */
function appendToJsonArray(filename, item) {
    const data = readJsonFile(filename, []);
    data.push(item);
    writeJsonFile(filename, data);
    return item;
}
/**
 * Update item in JSON array
 */
function updateInJsonArray(filename, predicate, updater) {
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
function deleteFromJsonArray(filename, predicate) {
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
function findInJsonArray(filename, predicate) {
    const data = readJsonFile(filename, []);
    return data.find(predicate) || null;
}
/**
 * Query JSON array with filters
 */
function queryJsonArray(filename, options) {
    let data = readJsonFile(filename, []);
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
