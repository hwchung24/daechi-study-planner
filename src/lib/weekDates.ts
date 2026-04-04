/** Monday-based week helpers used by student/parent shells */

export function getDateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMondayOfDate(d: Date): Date {
  const day = d.getDay();
  const diff = (day + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
}

/** `YYYY-MM-DD` 가 속한 주의 월요일 (동일 형식) — 내일 계획 등 특정 날짜 주간 조회용 */
export function getWeekStartKeyForDate(dateKey: string): string {
  const parts = String(dateKey)
    .trim()
    .slice(0, 10)
    .split("-")
    .map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
    return getWeekStartKey(0);
  }
  const [y, mo, day] = parts;
  const d = new Date(y, mo - 1, day);
  const monday = getMondayOfDate(d);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

/** 해당 주(월~일)가 속한 달 기준 "N월 첫째 주" 형식 */
export function getWeekTitle(offsetWeeks: number): string {
  const base = new Date();
  const day = base.getDay();
  const diffToMonday = (day + 6) % 7 - offsetWeeks * 7;
  const monday = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() - diffToMonday
  );
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const y = thursday.getFullYear();
  const m = thursday.getMonth();
  const firstOfMonth = new Date(y, m, 1);
  const firstMondayWeek = getMondayOfDate(firstOfMonth);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekIndex =
    Math.floor((monday.getTime() - firstMondayWeek.getTime()) / msPerWeek) + 1;
  const ordinals = ["첫", "두", "세", "네", "다섯"];
  const ordinal =
    weekIndex >= 1 && weekIndex <= 5 ? ordinals[weekIndex - 1] : String(weekIndex);
  return `${m + 1}월 ${ordinal}째 주`;
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
  const weekdayLong = [
    "일요일",
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일"
  ];
  return Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + idx
    );
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      key,
      /** 예: 4월 3일 금요일 */
      label: `${d.getMonth() + 1}월 ${d.getDate()}일 ${weekdayLong[d.getDay()]}`
    };
  });
}

/**
 * 주간 7칸에 캘린더 "내일"이 없을 때(예: 일요일인데 내일은 다음 주 월요일) 내일 카드를 한 칸 더 붙임.
 * 저장된 내일 계획이 항상 편집 가능한 카드에 표시되도록 함.
 */
export function getWeekDaysIncludingTomorrow(offsetWeeks: number) {
  const days = getWeekDays(offsetWeeks);
  const tomorrowKey = getDateKey(1);
  if (days.some(d => d.key === tomorrowKey)) {
    return days;
  }
  const t = new Date(`${tomorrowKey}T12:00:00`);
  const weekdayLong = [
    "일요일",
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일"
  ];
  return [
    ...days,
    {
      key: tomorrowKey,
      label: `${t.getMonth() + 1}월 ${t.getDate()}일 ${weekdayLong[t.getDay()]}`
    }
  ];
}
