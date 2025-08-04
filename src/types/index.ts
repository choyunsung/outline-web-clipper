
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
  outlineUrl?: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface ClipperMode {
  type: 'full' | 'simplified' | 'selection' | 'screenshot';
  options?: any;
}
