const KEY = "northline.history";

export type Visit = { url: string; title: string; at: number };

export function readVisits(): Visit[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isVisit).slice(0, 8);
  } catch {
    return [];
  }
}

export function rememberVisit(url: string, title: string) {
  const next = readVisits().filter((visit) => visit.url !== url);
  next.unshift({ url, title: title.trim() || url, at: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(next.slice(0, 8)));
}

export function clearVisits() {
  localStorage.removeItem(KEY);
}

function isVisit(value: unknown): value is Visit {
  if (!value || typeof value !== "object") return false;
  const visit = value as Visit;
  return typeof visit.url === "string" && typeof visit.title === "string" && typeof visit.at === "number";
}
