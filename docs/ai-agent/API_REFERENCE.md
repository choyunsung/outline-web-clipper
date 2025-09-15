# API 참조 문서

## 📡 메시지 통신 API

### Background ↔ Content Script 통신

#### 1. extractContent
**설명**: 웹 페이지 콘텐츠 추출 요청
```typescript
// 요청
{
  action: 'extractContent',
  options: ClipperOptions,
  mode: ClipperMode
}

// 응답
{
  success: boolean,
  content: PageContent | null,
  error?: string
}
```

#### 2. extractSelection
**설명**: 선택된 텍스트 추출
```typescript
// 요청
{
  action: 'extractSelection'
}

// 응답
{
  success: boolean,
  content: PageContent | null
}
```

#### 3. startSelectionMode
**설명**: 요소 선택 모드 시작
```typescript
// 요청
{
  action: 'startSelectionMode',
  mode: ClipperMode
}

// 응답
{
  success: boolean
}
```

#### 4. captureScreenshot
**설명**: 스크린샷 캡처
```typescript
// 요청
{
  action: 'captureScreenshot'
}

// 응답
{
  success: boolean,
  dataUrl: string
}
```

### Popup ↔ Background 통신

#### 1. clipPage
**설명**: 페이지 클리핑 실행
```typescript
// 요청
{
  action: 'clipPage',
  options: ClipperOptions,
  config: OutlineConfig,
  location: {
    collectionId: string,
    parentDocumentId?: string
  },
  mode: ClipperMode
}

// 응답
{
  success: boolean,
  documentId?: string,
  error?: string
}
```

#### 2. testConnection
**설명**: Outline 서버 연결 테스트
```typescript
// 요청
{
  action: 'testConnection',
  config: OutlineConfig
}

// 응답
{
  success: boolean,
  collections?: Collection[],
  error?: string
}
```

## 🔌 Outline API 클라이언트

### OutlineClient 클래스

#### constructor
```typescript
constructor(apiUrl: string, apiToken: string)
```

#### testConnection
**설명**: API 연결 테스트 및 Collection 목록 조회
```typescript
async testConnection(): Promise<{
  success: boolean;
  collections?: Collection[];
  error?: string;
}>
```

#### getCollections
**설명**: Collection 목록 조회
```typescript
async getCollections(): Promise<Collection[]>
```

#### getDocuments
**설명**: Collection 내 문서 목록 조회
```typescript
async getDocuments(collectionId: string): Promise<Document[]>
```

#### createDocument
**설명**: 새 문서 생성
```typescript
async createDocument(
  title: string,
  text: string,
  collectionId: string,
  parentDocumentId?: string,
  publish?: boolean
): Promise<{ id: string }>
```

#### uploadImage
**설명**: 이미지 업로드
```typescript
async uploadImage(
  imageBlob: Blob,
  fileName: string
): Promise<string>
```

## 📦 Storage API

### ConfigStorage 클래스

#### saveConfig
**설명**: 설정 저장
```typescript
static async saveConfig(config: OutlineConfig): Promise<void>
```

#### loadConfig
**설명**: 설정 불러오기
```typescript
static async loadConfig(): Promise<OutlineConfig>
```

#### saveOptions
**설명**: 클리퍼 옵션 저장
```typescript
static async saveOptions(options: ClipperOptions): Promise<void>
```

#### loadOptions
**설명**: 클리퍼 옵션 불러오기
```typescript
static async loadOptions(): Promise<ClipperOptions>
```

## 🎨 Content Extraction API

### ContentExtractor 클래스

#### extractContent
**설명**: 페이지 콘텐츠 추출
```typescript
async extractContent(
  options: ClipperOptions,
  mode?: ClipperMode
): Promise<PageContent>
```

#### extractSelection
**설명**: 선택 영역 추출
```typescript
async extractSelection(): Promise<PageContent | null>
```

#### extractElement
**설명**: 특정 요소 추출
```typescript
async extractElement(
  element: HTMLElement,
  options: ClipperOptions
): Promise<PageContent>
```

#### convertToMarkdown
**설명**: HTML을 Markdown으로 변환
```typescript
private convertToMarkdown(
  html: string,
  options: ClipperOptions
): string
```

## 📝 타입 정의

### OutlineConfig
```typescript
interface OutlineConfig {
  apiUrl: string;
  apiToken: string;
  defaultCollectionId: string;
}
```

### PageContent
```typescript
interface PageContent {
  title: string;
  content: string;
  markdown: string;
  excerpt?: string;
  author?: string;
  publishedDate?: string;
  images?: string[];
  url: string;
  selectedText?: string;
  screenshot?: string;
}
```

### Collection
```typescript
interface Collection {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  permission?: string;
  createdAt?: string;
  updatedAt?: string;
  documents?: Document[];
}
```

### Document
```typescript
interface Document {
  id: string;
  title: string;
  emoji?: string;
  collectionId?: string;
  parentDocumentId?: string | null;
  text?: string;
  children?: Document[];
}
```

### ClipperOptions
```typescript
interface ClipperOptions {
  includeImages: boolean;
  uploadImages: boolean;
  simplifyContent: boolean;
  addSourceUrl: boolean;
  addTimestamp: boolean;
  addHighlights: boolean;
  removeAds: boolean;
  keepFormatting: boolean;
  tags: string[];
}
```

### ClipperMode
```typescript
type ClipperMode =
  | { type: 'full' }
  | { type: 'selection' }
  | { type: 'screenshot' }
  | { type: 'element'; selector?: string };
```

## 🔄 이벤트 플로우

### 전체 페이지 클리핑 플로우
```
1. Popup: clipPage 메시지 전송
2. Background: Content Script에 extractContent 요청
3. Content: 페이지 분석 및 콘텐츠 추출
4. Content: 추출된 콘텐츠 반환
5. Background: Outline API 호출
6. Background: 문서 생성 및 이미지 업로드
7. Background: 결과 반환
8. Popup: 성공/실패 표시
```

### 요소 선택 모드 플로우
```
1. Popup: startSelectionMode 메시지 전송
2. Background: Content Script에 전달
3. Content: 마우스 이벤트 리스너 등록
4. Content: 호버 시 요소 하이라이트
5. Content: 클릭 시 요소 선택
6. Content: elementSelected 메시지 전송
7. Popup: 선택된 요소 정보 표시
8. Popup: 클리핑 실행
```

## 🛠️ 유틸리티 함수

### LinkProcessor
```typescript
class LinkProcessor {
  static processLinks(html: string, baseUrl: string): string
  static toAbsoluteUrl(url: string, baseUrl: string): string
  static processImages(html: string, baseUrl: string): string
}
```

### DefaultTemplate
```typescript
function createDefaultTemplate(
  content: PageContent,
  options: ClipperOptions
): string
```

## ⚠️ 에러 처리

### 공통 에러 코드
- `NETWORK_ERROR`: 네트워크 연결 실패
- `AUTH_ERROR`: 인증 실패
- `INVALID_CONFIG`: 잘못된 설정
- `EXTRACTION_ERROR`: 콘텐츠 추출 실패
- `API_ERROR`: Outline API 오류

### 에러 응답 형식
```typescript
interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: any;
}
```