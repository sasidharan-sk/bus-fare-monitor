const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export function pointMatches(actualList: string[] | undefined, chosen: string[]): boolean {
  if (chosen.length === 0) return true;
  if (!actualList || actualList.length === 0) return false;
  return chosen.some((c) =>
    actualList.some((a) => {
      const A = norm(a);
      const C = norm(c);
      return A.includes(C) || C.includes(A);
    }),
  );
}
