# Detectium Chrome Extension

[WXT](https://wxt.dev/) + **SolidJS** + TypeScript 기반의 초경량 Chrome Extension (Manifest V3) 프로젝트입니다.

## 📁 디렉터리 구조

```text
extension/
├── entrypoints/
│   ├── background.ts         # Service Worker (컨텍스트 메뉴, 탭 관리, 메시징)
│   ├── content.ts            # Content Script (Shadow DOM 플로팅 알림, DOM 접근)
│   ├── popup/                # 브라우저 상단 툴바 팝업 (SolidJS)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── style.css
│   └── options/              # 설정 (Options) 페이지 (SolidJS)
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       └── style.css
├── package.json
├── tsconfig.json             # SolidJS JSX 설정 (jsx: preserve, jsxImportSource: solid-js)
├── wxt.config.ts             # WXT 및 Manifest V3 설정 (@wxt-dev/module-solid)
└── README.md
```

## 🚀 개발 및 빌드 명령어

`extension` 폴더 경로에서 실행합니다:

```bash
# 의존성 설치
npm install

# 자동 개발 모드 (Vite HMR & 전용 크롬 브라우저 자동 실행)
npm run dev

# 프로덕션 빌드 (결과물: .output/chrome-mv3)
npm run build

# 배포용 zip 압축 생성
npm run zip

# 타입 검사
npm run compile
```

## 🧪 브라우저 테스트 방법

### 1. 자동 개발 모드 (추천)
```bash
npm run dev
```
- 확장 프로그램이 사전 로드된 전용 Chrome 인스턴스가 자동으로 실행됩니다.
- SolidJS의 반응형 시그널(Signal)과 Vite HMR을 통해 실시간으로 브라우저에 반영됩니다.

### 2. 본인 Chrome 브라우저에 수동 로드
1. `npm run build` 실행 (`.output/chrome-mv3` 생성)
2. Chrome 브라우저에서 `chrome://extensions/` 접속
3. 우측 상단 **개발자 모드** 활성화
4. 좌측 상단 **압축해제된 확장 프로그램을 로드합니다** 클릭
5. `d:\project\detectium\extension\.output\chrome-mv3` 폴더 선택
