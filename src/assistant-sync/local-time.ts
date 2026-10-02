export interface LocalVisitStamp {
  date: string;
  weekday: string;
  time: string;
}

/** Local calendar fields for the sheet. Dates stay text, not Sheets serials. */
export function localVisitStamp(visitedAt: number, timeZone: string): LocalVisitStamp {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(visitedAt));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    time: `${get("hour")}:${get("minute")}`,
  };
}
