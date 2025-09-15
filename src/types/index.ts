
// src/types/index.ts
export interface OutlineConfig {
  apiUrl: string;
  apiToken: string;
  defaultCollectionId?: string;
}

export interface ClipperOptions {
  includeImages: boolean;
  uploadImages: boolean;
  simplifyContent: boolean;
  addSourceUrl: boolean;
  addTimestamp: boolean;
  addHighlights: boolean;
  removeAds: boolean;
  keepFormatting: boolean;
  tags?: string[];
  template?: string;
}

export interface PageContent {
  title: string;
  content: string;
  url: string;
  excerpt?: string;
  author?: string;
  publishedDate?: string;
  images: ImageInfo[];
  selection?: string;
  highlights?: string[];
}

export interface ImageInfo {
  originalUrl: string;
  markdownUrl?: string;  // Markdown 콘텐츠 내 실제 URL (교체용)
  outlineUrl?: string;
  alt?: string;
  width?: number;
  height?: number;
  isContentImage?: boolean;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  documents?: Document[];
}

export interface Document {
  id: string;
  title: string;
  collectionId: string;
  parentDocumentId?: string;
  children?: Document[];
}

export interface ClipperMode {
  type: 'full' | 'simplified' | 'selection' | 'screenshot';
  options?: any;
}
