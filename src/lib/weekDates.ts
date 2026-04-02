/** Monday-based week helpers used by student/parent shells */

export function getDateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getWeekRangeLabel(offset: number) {
  const base = new Date();
  const day = base.getDay();
  const diffToMonday = (day + 6) % 7 - offset * 7;
  const monday = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() - diffToMonday
  );
  const sunday = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 6
  );

  const format = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

  return `${format(monday)} ~ ${format(sunday)}`;
}

export function getWeekStartKey(offsetWeeks: number) {
  const base = new Date();
  const day = base.getDay();
  const diffToMonday = (day + 6) % 7 - offsetWeeks * 7;
  const monday = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() - diffToMonday
  );
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

export function getWeekDays(offset: number) {
  const base = new Date();
  const day = base.getDay();
  const diffToMonday = (day + 6) % 7 - offset * 7;
  const monday = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() - diffToMonday
  );
  const labels = ["월", "화", "수", "목", "금", "토", "일"];
  return Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + idx
    );
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      key,
      label: `${d.getMonth() + 1}/${d.getDate()} (${labels[idx]})`
    };
  });
}
