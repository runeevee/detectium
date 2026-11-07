# detectium
SNS 왜곡 게시글 / 가짜뉴스 판별기
경고 띄우기

# roadmap
- [ ] 스크롤 내리다가 멈출때 그 타이밍에 현재 페이지에 있는 게시글마다 오브젝트화 해서 LLM에 전송 -> LLM에서 사실확인 완료 되면 답변 출력 -> UI로 표시

- [ ] UI로 경고 띄우기

## 테스트 방법
### extension
터미널을 extension에서 실행

(extension 폴더 우클릭 -> 통합 터미널에서 열기)
```
npm run build
```

```
아래 단계는 한번만 실행

- 크롬에서 chrome://extensions 접속
- 개발자모드 ON
- '압축해제된 확장 프로그램 코드' 버튼 클릭
- extension/.output/chrome-mv3 폴더 선택 후 등록
```

디버그

<AI님 추가해주세요>