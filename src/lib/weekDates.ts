/** Monday-based week helpers used by student/parent shells */

const SEOUL_TZ = "Asia/Seoul";

export function formatYmdInSeoul(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  if (!y || !m || !day) {
    const u = new Date(d.getTime() + 9 * 3600000);
    return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, "0")}-${String(u.getUTCDate()).padStart(2, "0")}`;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** API·JSON에서 온 로그 날짜(ISO 직렬화 등) → 서울 달력 YYYY-MM-DD */
export function seoulDateKeyFromApiValue(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}/.test(s)) {
    return formatYmdInSeoul(d);
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/**
 * 한국(서울) 달력 기준 YYYY-MM-DD. 브라우저/PC 타임존이 UTC·미국이어도 코치 로그·이번 주 그래프가 하루 어긋나지 않게 함.
 * (sv-SE+slice는 로케일/엔진마다 앞 10자가 날짜가 아닐 수 있어 formatToParts 고정)
 */
export function getDateKeySeoul(offsetDays = 0): string {
  const t = new Date(Date.now() + offsetDays * 86400000);
  return formatYmdInSeoul(t);
}

/**
 * YYYY-MM-DD 그레고리력 요일 (월=0 … 일=6).
 * en-US weekday 문자열은 로캘/웹뷰마다 달라 `?? 0`이 월요일로 떨어져 주·날짜가 무너질 수 있음.
 */
function weekdayMon0FromIsoDate(isoKey: string): number {
  const m = isoKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, day));
  return (utc.getUTCDay() + 6) % 7;
}

function addDaysToSeoulDateKey(isoKey: string, delta: number): string {
  const anchor = new Date(`${isoKey}T12:00:00+09:00`);
  const next = new Date(anchor.getTime() + delta * 86400000);
  return formatYmdInSeoul(next);
}

/** 서울 달력에서 해당 주의 월요일 키 (offsetWeeks: 0=이번 주). UTC ms로 하루 빼기 하지 않음(경계 날짜 어긋남 방지). */
export function getWeekStartKeySeoul(offsetWeeks = 0): string {
  const todayKey = getDateKeySeoul(0);
  let mondayKey = todayKey;
  for (let back = 0; back < 7; back++) {
    const key = addDaysToSeoulDateKey(todayKey, -back);
    if (weekdayMon0FromIsoDate(key) === 0) {
      mondayKey = key;
      break;
    }
  }
  return addDaysToSeoulDateKey(mondayKey, -7 * offsetWeeks);
}

/** 서울 기준 월~일 7칸 (getWeekDays와 동일 형태) */
export function getWeekDaysSeoul(offsetWeeks = 0) {
  const mondayKey = getWeekStartKeySeoul(offsetWeeks);
  return Array.from({ length: 7 }).map((_, idx) => {
    const key = addDaysToSeoulDateKey(mondayKey, idx);
    const anchor = new Date(`${key}T12:00:00+09:00`);
    const parts = new Intl.DateTimeFormat("ko-KR", {
      timeZone: SEOUL_TZ,
      month: "numeric",
      day: "numeric",
      weekday: "long"
    }).formatToParts(anchor);
    const mo = parts.find(p => p.type === "month")?.value ?? "";
    const day = parts.find(p => p.type === "day")?.value ?? "";
    const wd = parts.find(p => p.type === "weekday")?.value ?? "";
    return {
      key,
      label: `${mo}월 ${day}일 ${wd}`
    };
  });
}

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

/** 해당 주(월~일)가 속한 달 기준 "N월 첫째 주" 형식 (브라우저 로컬 달력) */
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
  const ordinals = ["첫", "둘", "셋", "넷", "다섯"];
  const ordinal =
    weekIndex >= 1 && weekIndex <= 5 ? ordinals[weekIndex - 1] : String(weekIndex);
  return `${m + 1}월 ${ordinal}째 주`;
}

/** 서울 달력 기준 "N월 첫째 주" (기록 탭 주간 스위처와 동일 타임존) */
export function getWeekTitleSeoul(offsetWeeks: number): string {
  const mondayKey = getWeekStartKeySeoul(offsetWeeks);
  const thursdayKey = addDaysToSeoulDateKey(mondayKey, 3);
  const parsed = thursdayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parsed) return getWeekTitle(offsetWeeks);
  const monthNum = Number(parsed[2]);
  const firstOfMonthKey = `${parsed[1]}-${parsed[2]}-01`;
  let firstMondayKey = firstOfMonthKey;
  for (let back = 0; back < 7; back++) {
    const key = addDaysToSeoulDateKey(firstOfMonthKey, -back);
    if (weekdayMon0FromIsoDate(key) === 0) {
      firstMondayKey = key;
      break;
    }
  }
  const monMs = new Date(`${mondayKey}T12:00:00+09:00`).getTime();
  const firstMonMs = new Date(`${firstMondayKey}T12:00:00+09:00`).getTime();
  const weekIndex = Math.floor((monMs - firstMonMs) / (7 * 86400000)) + 1;
  const ordinals = ["첫", "둘", "셋", "넷", "다섯"];
  const ordinal =
    weekIndex >= 1 && weekIndex <= 5 ? ordinals[weekIndex - 1] : String(weekIndex);
  return `${monthNum}월 ${ordinal}째 주`;
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

/** 서울 달력 월~일 (기록 탭·성장 리포트와 동일 타임존) */
export function getSeoulWeekRangeCompactLabel(offsetWeeks: number): string {
  const days = getWeekDaysSeoul(offsetWeeks);
  if (days.length < 7) return "";
  return `${days[0].label} — ${days[6].label}`;
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

/**
 * 기록 탭용: 서울 달력 주간 + (필요 시) 내일 카드.
 * API·코치 로그 날짜와 동일 기준이라 해외 타임존에서도 오늘 카드·스크롤 정렬이 맞음.
 */
export function getWeekDaysIncludingTomorrowSeoul(offsetWeeks: number) {
  const days = getWeekDaysSeoul(offsetWeeks);
  const tomorrowKey = getDateKeySeoul(1);
  if (days.some(d => d.key === tomorrowKey)) {
    return days;
  }
  const anchor = new Date(`${tomorrowKey}T12:00:00+09:00`);
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: SEOUL_TZ,
    month: "numeric",
    day: "numeric",
    weekday: "long"
  }).formatToParts(anchor);
  const mo = parts.find(p => p.type === "month")?.value ?? "";
  const day = parts.find(p => p.type === "day")?.value ?? "";
  const wd = parts.find(p => p.type === "weekday")?.value ?? "";
  return [
    ...days,
    {
      key: tomorrowKey,
      label: `${mo}월 ${day}일 ${wd}`
    }
  ];
}
