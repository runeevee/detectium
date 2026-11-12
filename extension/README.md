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

## 동영상 프레임 분석

Instagram 및 X 게시글의 동영상에서 최대 3개 프레임을 캡처해 이미지 분석 요청에 포함합니다. 정지된 영상은 초반·중간·후반 시점을 샘플링하고, 재생 중인 영상은 재생을 방해하지 않도록 현재 프레임만 캡처합니다. 프레임은 기존 이미지 변환과 같이 긴 변을 최대 1024px로 제한한 다음 가로·세로를 절반으로 줄입니다. 교차 출처 제한이나 로딩 상태로 캡처하지 못한 경우에는 게시글 포스터 이미지 분석을 계속합니다. 영상 음성은 분석하지 않습니다.

## 분석 토큰 최적화

분석 지침은 요청 간 재사용할 수 있도록 고정 부분을 앞에 두고 날짜만 뒤에 붙입니다. 사실 확인이 필요한 주장에는 계속 웹 검색을 요구하되, 일상·재미성 게시글의 불필요한 검색은 강제하지 않습니다. 판별력 유지를 위해 모델과 이미지 상세도는 변경하지 않았습니다.

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
