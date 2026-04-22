import { addDays, format, startOfDay } from "date-fns";

export function getTodayDate() {
  return startOfDay(new Date());
}

export function getTodayIsoDate() {
  return format(getTodayDate(), "yyyy-MM-dd");
}

export function getRelativeIsoDate(days: number) {
  return format(addDays(getTodayDate(), days), "yyyy-MM-dd");
}
