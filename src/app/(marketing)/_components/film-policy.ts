export type FilmEnvironment = {
  reducedMotion: boolean;
  reducedData: boolean;
  saveData: boolean;
  effectiveType?: string;
};

// Whether the background film may load and play. When it may not, the
// visitor just sees the still poster image, which is always present.
export function canAutoplayFilm(env: FilmEnvironment): boolean {
  // Motion sensitivity, and the explicit data-saver / reduced-data signals.
  if (env.reducedMotion || env.reducedData || env.saveData) return false;
  // Don't push a multi-MB background film at a very slow connection.
  if (env.effectiveType === "slow-2g" || env.effectiveType === "2g") return false;
  return true;
}
