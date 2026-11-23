# 4조 근무표 (hskim-calendar)

SK하이닉스 4조 3교대 **4조** 근무 달력. 아이폰 홈 화면에 추가해서 쓰는 웹앱(PWA)이며, 부부가 Google 캘린더로 근무 변경·메모를 공유합니다.

## 기능
- 월 달력 + 날짜별 근무 뱃지 (A 주간 07–15 / B 오후 15–23 / C 야간 23–07 / 휴 / 연차)
- 공휴일·기념일, 음력 1일·15일 표시, 오늘 강조, 좌우 스와이프로 월 이동
- **Google 캘린더 연동**
  - 선택한 Google 캘린더 일정(가족 일정, 공휴일 등)을 달력에 색 막대로 표시 (여러 날 일정은 이어서 표시)
  - 공유 캘린더 `4조 근무표`에 근무 일정 동기화 → 아이폰 기본 캘린더/구글 캘린더에도 표시
  - **알람**: 근무 일정에 "출근 N분 전" 알림 설정 (구글/아이폰 캘린더 알림으로 동작)
  - 근무 변경(연차·교환 등), 날짜 메모, 월별 메모를 공유 캘린더에 저장 → 배우자 폰에도 반영
- 월별 근무 통계 (근무일, 시간, 야간, 주말·공휴일 근무)
- Google 없이 쓰는 ICS 구독 링크 (`shifts.ics`, 기본 패턴만)

## 근무 패턴
24일 주기: `A×6 휴×2 B×6 휴×2 C×6 휴×2`, 기준일 **2026-11-05 = A 1일차** (`src/lib/shift.ts`).
C(야간)는 해당 날짜 23:00 시작 → 다음날 07:00 종료로 처리.

## 데이터 구조 (서버 없음)
| 데이터 | 저장 위치 |
|---|---|
| 기본 근무 패턴 | 코드 (`src/lib/shift.ts`) |
| 근무 변경 | 공유 캘린더 종일 일정 `[근무변경] X` (`extendedProperties.shared.kind=override`) |
| 근무 일정(알람) | 공유 캘린더 시간 일정 (`kind=shift`) |
| 메모 | 공유 캘린더 일반 일정 / 월별 메모는 `kind=monthMemo` |
| 기기 설정 | 브라우저 localStorage |

저장소는 Public이므로 **개인 데이터는 저장소에 넣지 않습니다** — 모두 Google 계정 안에만 있습니다.

## Google 설정 (최초 1회)
1. https://console.cloud.google.com → 새 프로젝트
2. **API 및 서비스 › 라이브러리** → `Google Calendar API` 사용 설정
3. **OAuth 동의 화면** → 외부(External) / 앱 이름 입력 / **테스트 사용자**에 부부 Gmail 2개 추가 (게시 상태는 '테스트' 유지)
4. **사용자 인증 정보 › OAuth 클라이언트 ID** → 웹 애플리케이션
   - 승인된 JavaScript 원본: `https://<github-id>.github.io`, `http://localhost:5173`
5. 발급된 클라이언트 ID를
   - GitHub 저장소 **Settings › Secrets and variables › Actions › Variables** 에 `GOOGLE_CLIENT_ID` 로 등록
   - 로컬 개발은 `.env.local` 에 `VITE_GOOGLE_CLIENT_ID=...`

## 아이폰 설치
1. Safari로 `https://<github-id>.github.io/hskim-calendar/` 열기 → 공유 › **홈 화면에 추가**
2. 앱 ☰ → Google 캘린더 연결 → `"4조 근무표" 캘린더 새로 만들기` → 배우자 이메일로 공유
3. 배우자는 "배우자용 앱 링크"를 Safari로 열고 홈 화면에 추가 → Google 연결
4. 아이폰 기본 캘린더에 보이게 하려면: 설정 › 캘린더 › 계정 › Google 계정 추가 (캘린더 켬)

## 개발
```bash
npm install
npm run dev     # http://localhost:5173
npm test        # 근무 패턴/음력/ICS 테스트
npm run build
node scripts/gen-icons.mjs   # 아이콘 재생성
```

배포: `main` 에 push 하면 GitHub Actions가 Pages로 배포합니다 (Settings › Pages › Source: **GitHub Actions**).
