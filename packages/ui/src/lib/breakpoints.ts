export const INKADE_BREAKPOINTS = {
  sm: 640,
  minMd768: 768,
  md: 800,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

export const INKADE_MEDIA_QUERIES = {
  sm: "(min-width: 640px)",
  maxSm: "(max-width: 639px)",
  min768: "(min-width: 768px)",
  max767: "(max-width: 767px)",
  md: "(min-width: 800px)",
  maxMd: "(max-width: 799px)",
  lg: "(min-width: 1024px)",
  xl: "(min-width: 1280px)",
  "2xl": "(min-width: 1536px)",
} as const;
