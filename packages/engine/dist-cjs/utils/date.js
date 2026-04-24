"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTodayDate = getTodayDate;
exports.getTodayIsoDate = getTodayIsoDate;
exports.getRelativeIsoDate = getRelativeIsoDate;
const date_fns_1 = require("date-fns");
function getTodayDate() {
    return (0, date_fns_1.startOfDay)(new Date());
}
function getTodayIsoDate() {
    return (0, date_fns_1.format)(getTodayDate(), "yyyy-MM-dd");
}
function getRelativeIsoDate(days) {
    return (0, date_fns_1.format)((0, date_fns_1.addDays)(getTodayDate(), days), "yyyy-MM-dd");
}
