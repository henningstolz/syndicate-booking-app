// Pure helpers for the flight log: the four clock times of a flight, how long
// it was, and the paper log's decimal-hour conversion. No imports, so the
// browser form (live preview) and the server use exactly the same maths.

// Minutes to decimal hours the way the paper conversion table does it:
// minutes / 60 rounded to one decimal, halves up (15' = .3, 20' = .3, 45' = .8,
// 50' = .8). The database applies the same rule (minutes_to_deci).
export function minutesToDeci(minutes: number): number {
  return Math.round(minutes / 6) / 10;
}

// "09:10" -> 550. Anything that is not HH:MM on a 24-hour clock -> null.
export function timeToMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Times are typed as plain HH:MM on the flight's date. A later time that is
// earlier on the clock than the one before it means the flight went past
// midnight, so it belongs to the next day. Returns how many days after the
// flight's date each time falls (0, 0, 0, 1 for 23:30, 23:40, 00:10, 00:20),
// or null if any time is missing or malformed.
export function dayOffsets(times: string[]): number[] | null {
  const offsets: number[] = [];
  let day = 0;
  let previous = -1;
  for (const time of times) {
    const minutes = timeToMinutes(time);
    if (minutes === null) return null;
    if (previous !== -1 && minutes < previous) day += 1;
    offsets.push(day);
    previous = minutes;
  }
  return offsets;
}

export type FlightDurations = {
  flightMinutes: number;
  blockMinutes: number;
  flightDeci: number;
  blockDeci: number;
};

// From the four times in order: brakes off, airborne, landed, brakes on.
// Flight time (airborne to landed) drives the airframe hours; block time
// (brakes off to brakes on) is for sharing costs.
export function flightDurations(times: string[]): FlightDurations | null {
  if (times.length !== 4) return null;
  const offsets = dayOffsets(times);
  if (!offsets) return null;
  const absolute = times.map(
    (time, i) => (timeToMinutes(time) as number) + offsets[i] * 1440,
  );
  const [off, up, down, on] = absolute;
  const flightMinutes = down - up;
  const blockMinutes = on - off;
  return {
    flightMinutes,
    blockMinutes,
    flightDeci: minutesToDeci(flightMinutes),
    blockDeci: minutesToDeci(blockMinutes),
  };
}

// 72 -> "1:12"
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// 1.2 -> "1.2", 3 -> "3.0"
export function formatDeci(value: number): string {
  return value.toFixed(1);
}
