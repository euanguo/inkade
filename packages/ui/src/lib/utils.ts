import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function prefersReducedMotion(): boolean {
  if (
    typeof document !== "undefined" &&
    document.documentElement?.dataset?.motion === "reduced-pulse"
  ) {
    return true;
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return true;
  }
  return false;
}
