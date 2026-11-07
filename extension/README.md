# Detectium Chrome Extension

[WXT](https://wxt.dev/) + React + TypeScript 기반의 Chrome Extension (Manifest V3) 프로젝트입니다.

## 📁 디렉터리 구조

```
extension/
├── entrypoints/
│   ├── content.ts            # 웹 페이지 DOM 접근 Content Script
│   └── options/              # 설정(Options) 페이지
│       ├── index.html        # Options HTML 진입점
│       ├── main.tsx          # React 마운트 스크립트
│       ├── App.tsx           # Options React 컴포넌트
│       └── style.css         # Options 스타일시트
├── package.json
├── tsconfig.json
├── wxt.config.ts             # WXT 및 Manifest V3 설정
└── README.md
```

## 🚀 개발 및 빌드 명령어

`extension` 폴더 경로에서 실행합니다:

```bash
# 의존성 설치
npm install

# 개발 모드 (Vite HMR & 자동 브라우저 로드)
npm run dev

# 프로덕션 빌드 (결과물: .output/chrome-mv3)
npm run build

# 배포용 zip 파일 생성
npm run zip

# 타입 체크
npm run compile
```

## 🌐 크롬 브라우저에 로드하는 방법

1. `npm run build` 실행 시 `.output/chrome-mv3` 폴더가 생성됩니다.
2. Chrome 브라우저에서 `chrome://extensions/` 주소로 이동합니다.
3. 우측 상단의 **개발자 모드(Developer mode)**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다(Load unpacked)** 버튼을 클릭합니다.
5. `d:\project\detectium\extension\.output/chrome-mv3` 폴더를 선택합니다.
6. 확장 프로그램 상세 페이지에서 **확장 프로그램 옵션**을 클릭하여 Options 페이지를 열 수 있습니다.
