// The drawing of the Blocktime mark, shared by the app icon (src/lib/app-icon.tsx,
// which makes the home-screen and browser-tab PNGs) and the small logo in the page
// headers (src/components/BrandMark.tsx), so they are always the same picture: a
// three-blade propeller seen from the front, off-white blades and an amber spinner
// on the site's night colour. All on a 512-unit square.
export const NIGHT = "#16242c";
export const PAPER = "#f4f5f0";
export const AMBER = "#b97327";

// One blade, pointing up from the hub at (256, 256), tip at the top.
export const BLADE = "M228 262C214 205 208 150 226 98C234 74 278 74 286 98C304 150 298 205 284 262Z";
export const BLADE_SCALE = 0.88;
export const BLADE_ANGLES = [0, 120, 240];
export const HUB_RADIUS = 45;
// A three-blade prop sits high in its square (one blade up, two down), so it is moved
// down to look centred.
export const DROP = 34;
export const BLADE_TRANSFORM = (angle: number) =>
  `translate(256 256) rotate(${angle}) scale(${BLADE_SCALE}) translate(-256 -256)`;
