// Running airframe totals for a list of flights, oldest first: the baseline
// plus the flight time of every earlier, non-voided entry. Pure and
// import-free so it can be tested on its own.
export type TotalsInput = {
  flightDeci: number;
  voided: boolean;
  // The check limit ("next check at N hours") remembered when the flight was
  // logged, or null if none was set then.
  checkLimitHours: number | null;
};

export type TotalsResult = {
  // Airframe total after this flight; null when the totals are not set up or
  // the entry is voided (a voided flight did not count).
  total: number | null;
  // Hours left to the next check after this flight, against the limit that
  // applied when it was logged; null when not known.
  toCheck: number | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export function runningTotals(
  entries: TotalsInput[],
  baseline: number | null,
): TotalsResult[] {
  let running = baseline;
  return entries.map((entry) => {
    if (entry.voided) return { total: null, toCheck: null };
    if (running !== null) running = round1(running + entry.flightDeci);
    return {
      total: running,
      toCheck:
        running !== null && entry.checkLimitHours !== null
          ? round1(entry.checkLimitHours - running)
          : null,
    };
  });
}
