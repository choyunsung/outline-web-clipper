# 📚 Outline Web Clipper - AI Agent 문서

이 문서는 AI Agent가 Outline Web Clipper 프로젝트를 이해하고 작업할 수 있도록 구조화된 정보를 제공합니다.

## 🎯 빠른 시작

### 프로젝트 이해를 위한 핵심 문서
1. **[PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)** - 전체 프로젝트 구조와 아키텍처
2. **[API_REFERENCE.md](./API_REFERENCE.md)** - API 및 메시지 통신 참조
3. **[DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)** - 개발 가이드 및 모범 사례

## 🤖 AI Agent를 위한 작업 가이드

### 1. 코드 분석 시작점
```bash
# 주요 엔트리 포인트
src/background.ts     # Background 서비스 워커
src/content.ts       # Content 스크립트
src/popup/popup.tsx  # Popup UI
```

### 2. 기능 모듈 위치
```bash
src/features/
├── content_extraction/  # 콘텐츠 추출 로직
├── outline_integration/ # Outline API 연동
├── storage/            # 데이터 저장 관리
└── templates/          # 문서 템플릿
```

### 3. 주요 작업 패턴

#### 새 기능 추가
1. `src/types/index.ts`에 타입 정의
2. `src/features/`에 기능 모듈 생성
3. Background/Content Script에 메시지 핸들러 추가
4. Popup UI에 컨트롤 추가

#### 버그 수정
1. Chrome DevTools로 에러 확인
2. 관련 모듈 찾기 (features/ 디렉토리)
3. 메시지 플로우 추적
4. 수정 및 테스트

#### API 통합
1. `src/features/outline_integration/client.ts` 확인
2. API 엔드포인트 추가/수정
3. 에러 핸들링 구현
4. 타입 정의 업데이트

## 📊 프로젝트 통계

- **주요 언어**: TypeScript (90%), CSS (5%), HTML (5%)
- **프레임워크**: React 18, Chrome Extension Manifest V3
- **빌드 도구**: Webpack 5
- **코드 라인 수**: ~2,000 lines
- **모듈 수**: 15개

## 🔍 코드 검색 힌트

### 특정 기능 찾기
```bash
# 콘텐츠 추출 관련
grep -r "extractContent" src/

# Outline API 관련
grep -r "OutlineClient" src/

# 메시지 핸들러
grep -r "chrome.runtime.onMessage" src/
```

### 타입 정의 찾기
```bash
# 모든 인터페이스
grep -r "interface" src/types/

# 특정 타입
grep -r "ClipperOptions" src/
```

## 💡 자주 수정되는 파일

1. **src/popup/popup.tsx** - UI 변경
2. **src/features/content_extraction/extractor.ts** - 추출 로직 개선
3. **src/features/outline_integration/client.ts** - API 통신
4. **src/types/index.ts** - 타입 정의
5. **webpack.config.js** - 빌드 설정

## 🚨 주의사항

### 반드시 확인해야 할 것들
- Chrome Extension Manifest V3 규격 준수
- Content Script와 Background 간 메시지 통신
- CORS 정책 (이미지 업로드 시)
- Chrome Storage API 용량 제한
- Service Worker 생명주기

### 피해야 할 패턴
- Content Script에서 직접 API 호출 (CORS 문제)
- 동기적 Chrome API 사용
- 큰 데이터를 메시지로 전송
- Service Worker에 상태 저장

## 🛠️ 유용한 명령어

```bash
# 개발 시작
npm run dev

# 빌드
npm run build

# 패키징
npm run package

# 타입 체크
npm run type-check

# 린트
npm run lint

# 클린 빌드
npm run clean && npm run build
```

## 📈 개선 가능한 영역

1. **성능 최적화**
   - 대용량 페이지 처리
   - 이미지 압축
   - 번들 크기 최소화

2. **기능 확장**
   - 배치 클리핑
   - 오프라인 모드
   - 템플릿 커스터마이징

3. **UX 개선**
   - 드래그 앤 드롭
   - 키보드 단축키
   - 진행 상태 표시

## 🔗 관련 링크

- [Chrome Extension 문서](https://developer.chrome.com/docs/extensions/mv3/)
- [Outline API 문서](https://www.getoutline.com/developers)
- [프로젝트 GitHub](https://github.com/choyunsung/outline-web-clipper)

---

**Note**: 이 문서는 AI Agent가 프로젝트를 빠르게 이해하고 효율적으로 작업할 수 있도록 설계되었습니다. 추가 정보가 필요한 경우 각 세부 문서를 참조하세요.