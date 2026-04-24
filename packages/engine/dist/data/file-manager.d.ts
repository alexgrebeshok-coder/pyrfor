/**
 * File Manager - Simple file-based storage for CEOClaw
 * Works out of the box, no database required
 */
/**
 * Read JSON file
 */
export declare function readJsonFile<T>(filename: string, defaultValue: T): T;
/**
 * Write JSON file
 */
export declare function writeJsonFile<T>(filename: string, data: T): void;
/**
 * Append to JSON array file
 */
export declare function appendToJsonArray<T>(filename: string, item: T): T;
/**
 * Update item in JSON array
 */
export declare function updateInJsonArray<T>(filename: string, predicate: (item: T) => boolean, updater: (item: T) => T): T | null;
/**
 * Delete item from JSON array
 */
export declare function deleteFromJsonArray<T>(filename: string, predicate: (item: T) => boolean): boolean;
/**
 * Find item in JSON array
 */
export declare function findInJsonArray<T>(filename: string, predicate: (item: T) => boolean): T | null;
/**
 * Query JSON array with filters
 */
export declare function queryJsonArray<T>(filename: string, options?: {
    filter?: (item: T) => boolean;
    sort?: (a: T, b: T) => number;
    limit?: number;
    offset?: number;
}): T[];
//# sourceMappingURL=file-manager.d.ts.map