
// src/features/outline_integration/client.ts
import { OutlineConfig, Collection, ImageInfo } from '../../types';

export class OutlineClient {
  private apiUrl: string;
  private apiToken: string;

  constructor(config: OutlineConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.apiToken = config.apiToken;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/auth.info`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async uploadImage(imageUrl: string): Promise<string> {
    try {
      // 이미지 다운로드
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error('이미지 다운로드 실패');
      }

      const blob = await imageResponse.blob();
      const fileName = this.generateFileName(imageUrl, blob.type);

      // FormData 생성
      const formData = new FormData();
      formData.append('file', blob, fileName);

      // Outline에 업로드
      const uploadResponse = await fetch(`${this.apiUrl}/api/attachments.create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error('이미지 업로드 실패');
      }

      const result = await uploadResponse.json();
      return result.data.url;
    } catch (error) {
      console.error('이미지 업로드 오류:', error);
      // 업로드 실패 시 원본 URL 반환
      return imageUrl;
    }
  }

  private generateFileName(url: string, mimeType: string): string {
    const extension = mimeType.split('/')[1] || 'png';
    const timestamp = Date.now();
    const urlParts = url.split('/');
    const originalName = urlParts[urlParts.length - 1].split('?')[0];

    if (originalName && originalName.includes('.')) {
      return originalName;
    }

    return `image_${timestamp}.${extension}`;
  }

  async createDocument(
    title: string,
    content: string,
    collectionId: string,
    options?: {
      publish?: boolean;
      parentDocumentId?: string;
    }
  ): Promise<any> {
    const response = await fetch(`${this.apiUrl}/api/documents.create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        text: content,
        collectionId,
        publish: options?.publish ?? true,
        parentDocumentId: options?.parentDocumentId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Outline API 오류: ${error}`);
    }

    return response.json();
  }

  async updateDocument(
    documentId: string,
    updates: {
      title?: string;
      text?: string;
      publish?: boolean;
    }
  ): Promise<any> {
    const response = await fetch(`${this.apiUrl}/api/documents.update`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: documentId,
        ...updates
      }),
    });

    if (!response.ok) {
      throw new Error('문서 업데이트 실패');
    }

    return response.json();
  }

  async getCollections(): Promise<Collection[]> {
    const response = await fetch(`${this.apiUrl}/api/collections.list`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 100,
      }),
    });

    if (!response.ok) {
      throw new Error('컬렉션 목록을 가져올 수 없습니다');
    }

    const data = await response.json();
    return data.data || [];
  }

  async searchDocuments(query: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/api/documents.search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit: 10,
        includeArchived: false
      }),
    });

    return response.json();
  }

  async processImagesInContent(content: string, images: ImageInfo[]): Promise<string> {
    let processedContent = content;

    for (const image of images) {
      if (image.originalUrl) {
        try {
          const outlineUrl = await this.uploadImage(image.originalUrl);
          image.outlineUrl = outlineUrl;

          // 콘텐츠에서 이미지 URL 교체
          processedContent = processedContent.replace(
            new RegExp(this.escapeRegExp(image.originalUrl), 'g'),
            outlineUrl
          );
        } catch (error) {
          console.error(`이미지 업로드 실패: ${image.originalUrl}`, error);
        }
      }
    }

    return processedContent;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}


