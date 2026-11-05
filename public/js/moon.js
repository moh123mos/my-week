// Moon geometry shared by the on-screen summary and the share image. No DOM.
export const MOON_RADIUS = 42;

// The lit part of a moon in a 100x100 box: the right limb, then the terminator back up. fraction is 0..1.
export const moonPath = fraction => {
  const terminator = (MOON_RADIUS * Math.abs(1 - 2 * fraction)).toFixed(2);
  return `M50 8A${MOON_RADIUS} ${MOON_RADIUS} 0 0 1 50 92A${terminator} ${MOON_RADIUS} 0 0 ${fraction > .5 ? 1 : 0} 50 8Z`;
};
