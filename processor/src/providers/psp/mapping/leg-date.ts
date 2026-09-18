/** Unzer's offset-less leg timestamp, `YYYY-MM-DD HH:mm:ss[.SSS]`, denominated in UTC. */
const OFFSETLESS_LEG_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/** The leg date as an offset-carrying ISO-8601 string; a value outside the offset-less shape passes verbatim. */
export function legDateIso(date: string): string {
  const offsetless = OFFSETLESS_LEG_DATE.exec(date);
  return offsetless ? `${offsetless[1]}T${offsetless[2]}Z` : date;
}
