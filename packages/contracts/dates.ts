import { z } from "zod";
export function parisDateTime(day: string, time: string) {
  z.iso.date().parse(day);
  z.string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .parse(time);
  const target = day + " " + time;
  const matches: string[] = [];
  for (const offset of [60, 120]) {
    const ms = Date.parse(day + "T" + time + ":00Z") - offset * 60000;
    const result = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms));
    if (result === target) matches.push(new Date(ms).toISOString());
  }
  if (matches.length !== 1)
    throw new Error(
      matches.length ? "AMBIGUOUS_LOCAL_TIME" : "INVALID_LOCAL_TIME",
    );
  return matches[0];
}
