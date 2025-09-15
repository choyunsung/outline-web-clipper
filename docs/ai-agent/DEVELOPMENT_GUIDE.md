# 개발 가이드

## 🚀 시작하기

### 사전 요구사항
- Node.js >= 16.0.0
- npm >= 8.0.0
- Chrome 브라우저
- Outline Wiki 인스턴스 및 API 토큰

### 설치 및 설정
```bash
# 1. 저장소 클론
git clone https://github.com/choyunsung/outline-web-clipper.git
cd outline-web-clipper

# 2. 의존성 설치
npm install

# 3. 개발 모드 실행
npm run dev
```

### Chrome Extension 로드
1. Chrome 브라우저에서 `chrome://extensions` 접속
2. "개발자 모드" 활성화
3. "압축 해제된 확장 프로그램 로드" 클릭
4. `dist` 폴더 선택

## 📝 코드 작성 가이드

### 1. 새 기능 추가

#### Feature 모듈 생성
```typescript
// src/features/my_feature/index.ts
export class MyFeature {
  constructor() {
    // 초기화
  }

  async execute(params: any): Promise<Result> {
    // 기능 구현
  }
}
```

#### 타입 정의 추가
```typescript
// src/types/index.ts
export interface MyFeatureParams {
  // 파라미터 정의
}

export interface MyFeatureResult {
  // 결과 타입 정의
}
```

### 2. 메시지 핸들러 추가

#### Background Script
```typescript
// src/background.ts
async function handleMessage(request: any, sender: any, sendResponse: Function) {
  switch (request.action) {
    case 'myNewAction':
      const result = await handleMyNewAction(request.data);
      sendResponse(result);
      break;
  }
}

async function handleMyNewAction(data: any) {
  try {
    // 작업 수행
    return { success: true, result: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

#### Content Script
```typescript
// src/content.ts
private async handleMessage(request: any, sendResponse: Function) {
  switch (request.action) {
    case 'myContentAction':
      const result = await this.myContentAction(request.data);
      sendResponse(result);
      break;
  }
}
```

### 3. UI 컴포넌트 추가

#### React 컴포넌트
```typescript
// src/popup/components/MyComponent.tsx
import React, { useState } from 'react';

interface MyComponentProps {
  onAction: (data: any) => void;
}

export const MyComponent: React.FC<MyComponentProps> = ({ onAction }) => {
  const [state, setState] = useState('');

  const handleClick = () => {
    onAction(state);
  };

  return (
    <div className="my-component">
      <input value={state} onChange={(e) => setState(e.target.value)} />
      <button onClick={handleClick}>Action</button>
    </div>
  );
};
```

### 4. Chrome Storage 사용

#### 데이터 저장
```typescript
async function saveData(key: string, value: any): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}
```

#### 데이터 로드
```typescript
async function loadData<T>(key: string): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] || null);
    });
  });
}
```

## 🧪 테스트

### 단위 테스트
```bash
# 테스트 실행
npm test

# 커버리지 확인
npm run test:coverage
```

### 수동 테스트 체크리스트
- [ ] Extension 설치 및 활성화
- [ ] Popup UI 정상 동작
- [ ] Outline 서버 연결
- [ ] 전체 페이지 클리핑
- [ ] 선택 영역 클리핑
- [ ] 스크린샷 클리핑
- [ ] 요소 선택 모드
- [ ] 이미지 업로드
- [ ] 설정 저장/로드

## 🐛 디버깅

### Background Script 디버깅
1. `chrome://extensions` 접속
2. Extension 카드에서 "Service Worker" 클릭
3. DevTools Console에서 디버깅

### Content Script 디버깅
1. 웹 페이지에서 F12 (DevTools 열기)
2. Console 탭에서 로그 확인
3. Sources 탭에서 브레이크포인트 설정

### Popup 디버깅
1. Extension 아이콘 우클릭
2. "검사" 선택
3. DevTools에서 디버깅

### 유용한 디버깅 코드
```typescript
// 현재 탭 정보 확인
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  console.log('Current tab:', tabs[0]);
});

// Storage 내용 확인
chrome.storage.local.get(null, (items) => {
  console.log('Storage:', items);
});

// 메시지 로깅
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received:', request, 'from:', sender);
  return true;
});
```

## 📦 빌드 및 배포

### 프로덕션 빌드
```bash
# 빌드 실행
npm run build

# 패키징
npm run package
```

### 빌드 최적화
```javascript
// webpack.config.js 수정 예시
module.exports = {
  optimization: {
    minimize: true,
    splitChunks: {
      chunks: 'all',
    },
  },
};
```

### Chrome Web Store 배포
1. [Chrome Web Store 개발자 대시보드](https://chrome.google.com/webstore/devconsole) 접속
2. 새 항목 추가 또는 기존 항목 업데이트
3. `releases/outline-clipper.zip` 업로드
4. 스토어 등록 정보 작성
5. 검토 제출

## 🔧 일반적인 문제 해결

### Extension이 로드되지 않음
- `manifest.json` 문법 오류 확인
- 필수 파일 존재 여부 확인
- Chrome 버전 호환성 확인

### API 연결 실패
- CORS 정책 확인
- API 토큰 유효성 확인
- 네트워크 연결 상태 확인

### Content Script가 실행되지 않음
- `manifest.json`의 `content_scripts` 설정 확인
- 페이지 URL이 매치 패턴과 일치하는지 확인
- CSP(Content Security Policy) 제한 확인

### 이미지 업로드 실패
- 이미지 크기 제한 확인
- CORS 정책 확인
- Base64 인코딩 문제 확인

## 🎯 성능 최적화

### 1. 번들 크기 최소화
```javascript
// 동적 임포트 사용
const module = await import('./heavy-module');
```

### 2. 메모리 관리
```typescript
// 이벤트 리스너 정리
componentWillUnmount() {
  chrome.runtime.onMessage.removeListener(this.handleMessage);
}
```

### 3. 비동기 처리 최적화
```typescript
// Promise.all 사용
const [collections, options] = await Promise.all([
  client.getCollections(),
  ConfigStorage.loadOptions()
]);
```

## 📚 추가 리소스

### 공식 문서
- [Chrome Extension 개발 가이드](https://developer.chrome.com/docs/extensions/mv3/)
- [Manifest V3 마이그레이션](https://developer.chrome.com/docs/extensions/mv3/intro/mv3-migration/)
- [Chrome Extension API 참조](https://developer.chrome.com/docs/extensions/reference/)

### Outline API
- [Outline API 문서](https://www.getoutline.com/developers)
- [Outline GitHub](https://github.com/outline/outline)

### 유용한 도구
- [Extension Reloader](https://chrome.google.com/webstore/detail/extensions-reloader/fimgfedafeadlieiabdeeaodndnlbhid)
- [Chrome Extension Source Viewer](https://chrome.google.com/webstore/detail/chrome-extension-source-v/jifpbeccnghkjeaalbbjmodiffmgedin)

## 🤝 기여 가이드

### 코드 스타일
- TypeScript strict 모드 사용
- ESLint 규칙 준수
- Prettier 포맷팅 적용

### 커밋 메시지 규칙
```
feat: 새로운 기능 추가
fix: 버그 수정
docs: 문서 수정
style: 코드 포맷팅
refactor: 코드 리팩토링
test: 테스트 코드
chore: 빌드 또는 보조 도구 수정
```

### Pull Request 체크리스트
- [ ] 코드가 빌드되고 테스트 통과
- [ ] 새 기능에 대한 문서 추가
- [ ] 기존 기능 영향 없음 확인
- [ ] Chrome/Edge/Brave 호환성 확인