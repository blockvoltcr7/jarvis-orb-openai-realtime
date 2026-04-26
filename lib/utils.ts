export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function clamp(v: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}
