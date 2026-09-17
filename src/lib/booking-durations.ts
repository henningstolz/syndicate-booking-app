// Shared between the booking form (display text) and the server
// action (actual computation) — a "use server" file can only export
// async functions, so these live in their own plain module.
export const FULL_DAY_START = "07:00";
export const FULL_DAY_END = "19:00";
export const HALF_DAY_SPLIT = "13:00";
