
// src/features/content_extraction/extractor.ts
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { PageContent, ImageInfo, ClipperOptions } from '../../types';

export class ContentExtractor {
  private turndown: TurndownService;
  private turndownSimple: TurndownService;

  constructor() {
    // 표준 Turndown 서비스
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      hr: '---'
    });

    // 단순화된 Turndown 서비스
    this.turndownSimple = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      hr: '---'
    });

    this.setupTurndownRules();
  }

  private setupTurndownRules() {
    // 이미지 처리 규칙
    const imageRule = {
      filter: 'img',
      replacement: (content: string, node: any) => {
        const img = node as HTMLImageElement;
        const alt = img.alt || 'image';
        const src = img.src || img.dataset.src || img.dataset.lazySrc;
        return `![${alt}](${src})`;
      }
    };

    this.turndown.addRule('images', imageRule);
    this.turndownSimple.addRule('images', imageRule);

    // 코드 블록 처리
    this.turndown.addRule('pre-code', {
      filter: (node) => {
        return node.nodeName === 'PRE' &&
               node.firstChild?.nodeName === 'CODE';
      },
      replacement: (content, node) => {
        const codeNode = node.firstChild as HTMLElement;
        const lang = codeNode.className.match(/language-(\w+)/)?.[1] || '';
        return `\n\`\`\`${lang}\n${codeNode.textContent}\n\`\`\`\n`;
      }
    });

    // 테이블 처리
    this.turndown.addRule('tables', {
      filter: 'table',
      replacement: (content, node) => {
        const table = node as HTMLTableElement;
        return this.convertTableToMarkdown(table);
      }
    });

    // 단순화 모드에서는 일부 요소 제거
    this.turndownSimple.remove(['script', 'style', 'nav', 'aside', 'footer']);
  }

  async extractContent(options: ClipperOptions): Promise<PageContent> {
    const documentClone = document.cloneNode(true) as Document;

    // 광고 제거
    if (options.removeAds) {
      this.removeAds(documentClone);
    }

    // Readability로 메인 콘텐츠 추출
    const reader = new Readability(documentClone, {
      keepClasses: options.keepFormatting
    });
    const article = reader.parse();

    if (!article) {
      throw new Error('콘텐츠 추출 실패');
    }

    // 선택한 Turndown 서비스 사용
    const converter = options.simplifyContent ? this.turndownSimple : this.turndown;
    const markdown = converter.turndown(article.content);

    // 이미지 정보 추출
    const images = await this.extractImages(article.content);

    // 하이라이트 추출
    const highlights = options.addHighlights ? this.extractHighlights() : undefined;

    return {
      title: article.title || document.title,
      content: markdown,
      url: window.location.href,
      excerpt: article.excerpt,
      author: article.byline,
      publishedDate: this.extractPublishedDate(),
      images,
      highlights
    };
  }

  async extractSelection(): Promise<PageContent | null> {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const container = document.createElement('div');
    container.appendChild(range.cloneContents());

    const markdown = this.turndown.turndown(container.innerHTML);
    const images = await this.extractImages(container.innerHTML);

    return {
      title: document.title,
      content: markdown,
      url: window.location.href,
      images,
      selection: selection.toString()
    };
  }

  private async extractImages(html: string): Promise<ImageInfo[]> {
    const div = document.createElement('div');
    div.innerHTML = html;
    const imgs = div.querySelectorAll('img');

    const images: ImageInfo[] = [];

    for (const img of Array.from(imgs)) {
      const src = img.src || img.dataset.src || img.dataset.lazySrc;
      if (src && !src.startsWith('data:')) {
        // 절대 URL로 변환
        const absoluteUrl = new URL(src, window.location.href).href;

        images.push({
          originalUrl: absoluteUrl,
          alt: img.alt,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height
        });
      }
    }

    return images;
  }

  private removeAds(doc: Document) {
    // 일반적인 광고 선택자
    const adSelectors = [
      '[class*="ad-"]',
      '[class*="ads-"]',
      '[class*="advertisement"]',
      '[id*="ad-"]',
      '[id*="ads-"]',
      '.adsbygoogle',
      '.ad-container',
      '.advertisement',
      '.sponsored',
      '[data-ad]',
      '[data-ads]',
      'iframe[src*="doubleclick"]',
      'iframe[src*="googlesyndication"]'
    ];

    adSelectors.forEach(selector => {
      doc.querySelectorAll(selector).forEach(el => el.remove());
    });
  }

  private extractHighlights(): string[] {
    const highlights: string[] = [];

    // 하이라이트된 텍스트 찾기 (mark, highlight 클래스 등)
    const highlightSelectors = [
      'mark',
      '.highlight',
      '.highlighted',
      '[style*="background-color: yellow"]'
    ];

    highlightSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length > 0) {
          highlights.push(text);
        }
      });
    });

    return highlights;
  }

  private extractPublishedDate(): string | undefined {
    const selectors = [
      'meta[property="article:published_time"]',
      'meta[name="publish_date"]',
      'meta[property="datePublished"]',
      'meta[itemprop="datePublished"]',
      'time[datetime]',
      'meta[name="date"]',
      '.publish-date',
      '.post-date'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const date = element.getAttribute('content') ||
                    element.getAttribute('datetime') ||
                    element.textContent;
        if (date) return date;
      }
    }

    return undefined;
  }

  private convertTableToMarkdown(table: HTMLTableElement): string {
    const rows = Array.from(table.rows);
    if (rows.length === 0) return '';

    let markdown = '\n\n';
    const headers = Array.from(rows[0].cells).map(cell => cell.textContent?.trim() || '');

    // 헤더
    markdown += '| ' + headers.join(' | ') + ' |\n';
    markdown += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

    // 데이터 행
    for (let i = 1; i < rows.length; i++) {
      const cells = Array.from(rows[i].cells).map(cell => cell.textContent?.trim() || '');
      markdown += '| ' + cells.join(' | ') + ' |\n';
    }

    return markdown + '\n';
  }

  async captureScreenshot(): Promise<string> {
    // 스크린샷 캡처는 background script에서 처리
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'captureScreenshot' }, (response) => {
        resolve(response.dataUrl);
      });
    });
  }
}
