# 대치루트 앱 톤앤매너 (학생 화면 기준)

> 학생 코치·프로필·타임라인 UI를 기준으로 정리했습니다. 학부모 화면도 동일 토큰·패턴을 따릅니다.

## 1. 디자인 철학

- **iOS 그룹드 UI**: 배경 `#f2f2f7`(`--bg`), 카드·리스트는 흰/글래스 면 위에 얹음.
- **포인트 컬러 1개**: 남색 `--accent` `#243b6b` — 상태별 빨강/초록 남발 없음.
- **스캔 우선**: 큰 숫자(KPI) → 섹션 라벨 → 본문. 장문은 카드 1장·접기.
- **절제된 모션**: `--dur-fast` 160ms, `--ease-standard` cubic-bezier. 카드·버튼에 짧은 transition, 과한 bounce 없음.

## 2. 색·타이포 토큰 (`:root`)

| 토큰 | 값/용도 |
|------|---------|
| `--bg` | `#f2f2f7` 페이지 배경 |
| `--surface-base` | `#ffffff` 카드 기본 |
| `--accent` | `#243b6b` CTA·활성·아이콘 배경 |
| `--accent-soft` | 남색 12% — 섹션 아이콘 칩 |
| `--text-strong` / `--text-main` | 제목·본문 |
| `--text-sub` | 보조·캡션 |
| `--font-size-large` | 18px — KPI·상태 한 줄 |
| `--font-size-medium` | 14px — 본문 |
| `--font-size-small` | 12px — eyebrow·힌트 |
| `--radius-lg` | 18px — 카드 |
| `--radius-pill` | 칩·탭 |

## 3. 핵심 컴포넌트 패턴

### 3.1 `coach-card`

```css
background: var(--surface-base);
border: 1px solid var(--border-neutral);
border-radius: var(--radius-lg);
box-shadow: var(--shadow-soft); /* 전역 glass 리프레시 시 surface-glass + hairline */
padding: 16px (coach-card--padded);
```

학생·학부모 공통. 카드끼리 간격 10~16px.

### 3.2 인사이트 — `coach-home-insight-card` / `coach-analysis-hero`

- **Eyebrow**: `coach-home-insight-card__eyebrow` — small, semibold, `--text-sub`, uppercase letter-spacing.
- **제목/상태**: `coach-analysis-hero__title` — large, bold, `--text-strong`.
- **본문**: `coach-home-insight-card__body` — medium, line-height 1.55.
- **액션 박스**(선택): `coach-analysis-hero__action-box` — 연한 neutral 배경, border soft.
- 보라/민트 그라데이션 인사이트 박스는 사용하지 않음.

### 3.3 KPI — `coach-metric` / `coach-pill`

- **coach-metric**: 아이콘(남색 soft 칩) + 작은 제목 + **큰 value** + hint.
- **coach-pill**: 가로 칩, label/value 쌍 — 필터·요약용.

### 3.4 설정 — `settings-item`

- 카드 안 `student-profile-settings-list`, 행은 full-width, separator `0.5px`.
- `settings-label` (main) + `settings-value` (sub), 탭 시 배경 살짝 변화.

### 3.5 버튼

- **Primary**: `coach-primary-btn` / `timeline-save-button` — 남색 fill, pill 또는 button radius.
- **Ghost**: `coach-ghost-btn` — 테두리만.
- **활성 탭/필터**: `coach-analysis-trend-tab--active` — accent fill.

### 3.6 섹션 헤더 — `coach-section-header`

- 왼쪽: 40px 아이콘 wrap (`--accent-soft` 배경) + `coach-section-title`.
- 오른쪽: 토글·시간 등 보조 컨트롤.

## 4. 레이아웃·간격

- 페이지: `coach-page` — padding 0, `min-height 100%`, 배경은 `--bg`가 비침.
- 프로필형: `student-profile-page` — `gap: 22px` 세로 스택.
- 그리드 KPI: `coach-grid` / `coach-analysis-metric-grid` — 2열 metric.

## 5. 학부모 화면 적용 원칙 (2026-05)

학부모 전용이 학생과 달랐던 점 → 정렬 방향:

| 이전 (학부모 only) | 학생 톤에 맞춤 |
|-------------------|----------------|
| 페이지 배경 순백 | `--bg` 그룹드 회색 |
| 전역 `animation/transition: none` | 카드·버튼만 학생과 동일 transition |
| 모바일 글자 축소 (11px medium) | `:root` 타이포 그대로 |
| 보라 그라데이션 인사이트 | `coach-card` + insight 패턴 |
| flat 카드 (shadow none) | `surface-glass` + hairline |
| 별도 parent-type 22px | `coach-metric__value` / `--font-size-large` |

## 6. 참고 파일

- 토큰·글로벌: `src/styles.css` `:root`, glass refresh 블록
- 학생 코치: `src/coach/student/StudentCoachApp.tsx`
- 학생 프로필: `src/components/student/StudentProfilePage.tsx`
- 공통 UI: `src/coach/ui/components.tsx` (`Card`, `MetricCard`, `SectionHeader`)
- 학부모: `src/coach/parent/*`, `.app-root--parent` in `styles.css`

## 7. 학부모 Hero·알림·빈 상태 (2026-05)

| 영역 | 패턴 |
|------|------|
| **홈 순서** | 이번 주 인사이트 → 지금 상태 Hero → 빠른 설정 → 기록 |
| **Status Hero** | `parent-home__status-hero` — 연결·위치·모드·공부 **유일한 상태 문구**. KPI 칩·제어 카드에 같은 내용 반복 금지. |
| **연결 끊김** | Hero 연결 행 안 인라인 `parent-home__hero-inline-btn` 「다시 확인」 (별도 경고 카드 없음) |
| **제어 카드** | `parent-home__control-grid` — 조작만(설정·자유시간·계획표). `parent-home__action-btn` radius `var(--radius-lg)` 통일 |
| **빈 상태** | `ko.json` `parentHomeTab.statusHero*` / `parentModeExplain.*` — 안내 1문장, 「체크아웃」만 단독 표시 금지 |
| **알림** | `ParentNotificationsPending` + 필터 칩(`미읽음`/`전체`) + 제목 키워드 섹션(계획·연결·기타) |
| **주간 기록** | `ParentRecordsWeekSummary` — recharts 막대 + 과목 horizontal bar, CTA는 `#/parent/analysis` |

## 8. QA 체크 (학부모)

- [ ] 배경이 학생 화면과 같은 연회색인가
- [ ] 인사이트·성장 리포트 상단이 흰 카드 + 남색 포인트인가 (보라 없음)
- [ ] KPI 숫자 크기·굵기가 코치 분석 탭 metric과 비슷한가
- [ ] 설정 리스트가 프로필 설정과 같은 separator/list인가
- [ ] 버튼·카드 탭 시 짧은 scale/배경 변화가 있는가
- [ ] 홈 Hero가 KPI 위에 있고, 연결 끊김 시 alert 스트립이 보이는가
- [ ] 알림 탭에서 plan-add 승인·거절·미읽음 필터가 동작하는가
- [ ] 하단 5탭·헤더 「리포트」 메뉴가 **추가되지 않았는지**
