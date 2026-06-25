import type { CheckInPeriod } from "./events.js";

export function getPeriodKey(period: CheckInPeriod, date: Date): string {
  switch (period) {
    case "daily":
      return formatLocalDateKey(date);
    case "monthly":
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    case "weekly":
      return formatLocalIsoWeekKey(date);
  }
}

function formatLocalDateKey(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-");
}

function formatLocalIsoWeekKey(date: Date): string {
  const weekDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const day = weekDate.getDay() === 0 ? 7 : weekDate.getDay();
  weekDate.setDate(weekDate.getDate() + 4 - day);

  const yearStart = new Date(weekDate.getFullYear(), 0, 1);
  const daysSinceYearStart =
    Math.floor((weekDate.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const week = Math.ceil(daysSinceYearStart / 7);

  return `${weekDate.getFullYear()}-W${pad2(week)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
