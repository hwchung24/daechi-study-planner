export function formatMinutes(n: number) {
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h <= 0) return `${m}분`;
  return `${h}시간 ${m}분`;
}
