
// src/features/content_extraction/extractor.ts
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { PageContent, ImageInfo, ClipperOptions } from '../../types';
import { LinkProcessor } from './link-processor';

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
    const imageRule: TurndownService.Rule = {
      filter: 'img' as TurndownService.Filter,
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

    // 특수 태그로 마킹된 링크 처리
    const embedTagRule: TurndownService.Rule = {
      filter: (node) => {
        return node.nodeName === 'SPAN' && 
               (node as HTMLElement).classList.contains('outline-embed-tag');
      },
      replacement: (content) => content
    };

    this.turndown.addRule('embed-tags', embedTagRule);
    this.turndownSimple.addRule('embed-tags', embedTagRule);

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

    // HTML에서 링크 처리 (Markdown 변환 전)
    let processedContent = article.content || '';
    processedContent = LinkProcessor.processLinksInHtml(processedContent);

    // 선택한 Turndown 서비스 사용
    const converter = options.simplifyContent ? this.turndownSimple : this.turndown;
    let markdown = converter.turndown(processedContent);

    // Markdown에서 링크 처리 (Outline 태그로 변환)
    markdown = LinkProcessor.processLinks(markdown);

    // Markdown 콘텐츠에서 이미지 정보 추출
    const images = this.extractImagesFromMarkdown(markdown, article.content || '');

    // 하이라이트 추출
    const highlights = options.addHighlights ? this.extractHighlights() : undefined;

    return {
      title: article.title || document.title,
      content: markdown,
      url: window.location.href,
      excerpt: article.excerpt || undefined,
      author: article.byline || undefined,
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

    // 링크 처리
    let processedHtml = LinkProcessor.processLinksInHtml(container.innerHTML);
    let markdown = this.turndown.turndown(processedHtml);
    markdown = LinkProcessor.processLinks(markdown);

    // Markdown 콘텐츠에서 이미지 정보 추출
    const images = this.extractImagesFromMarkdown(markdown, container.innerHTML);

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
    
    const images: ImageInfo[] = [];
    const seenUrls = new Set<string>();

    console.log('이미지 추출 시작...');

    // 1. 일반 img 태그에서 이미지 추출 (최우선)
    await this.extractFromImgTags(div, images, seenUrls);

    // 2. picture 태그에서 이미지 추출
    await this.extractFromPictureTags(div, images, seenUrls);

    // 3. srcset 속성에서 고화질 이미지 추출
    await this.extractFromSrcset(div, images, seenUrls);

    // 4. 동적 로딩 이미지 (intersection observer 등) 처리
    await this.extractDynamicImages(images, seenUrls);

    // 5. CSS background-image에서 이미지 추출 (콘텐츠 이미지일 가능성)
    await this.extractFromBackgroundImages(div, images, seenUrls);

    // 6. SVG 이미지 추출 (최하위 우선순위, 콘텐츠 이미지가 충분하지 않을 때만)
    if (images.length < 3) {
      await this.extractFromSvgTags(div, images, seenUrls);
    } else {
      console.log('콘텐츠 이미지가 충분하여 SVG 추출을 건너뜀');
    }

    console.log(`이미지 추출 완료: ${images.length}개`);
    return images;
  }

  private async extractFromImgTags(container: Element, images: ImageInfo[], seenUrls: Set<string>) {
    const imgs = container.querySelectorAll('img');
    console.log(`img 태그 ${imgs.length}개 발견`);

    for (const img of Array.from(imgs)) {
      // 이미지 크기로 콘텐츠 이미지 우선 판별
      const width = img.naturalWidth || img.width || parseInt(img.getAttribute('width') || '0');
      const height = img.naturalHeight || img.height || parseInt(img.getAttribute('height') || '0');
      const isContentSized = width >= 200 && height >= 150; // 콘텐츠 이미지로 판단되는 최소 크기
      
      // 다양한 src 속성 확인
      const srcCandidates = [
        img.src,
        img.dataset.src,
        img.dataset.lazySrc,
        img.dataset.original,
        img.dataset.actualSrc,
        img.getAttribute('data-lazy-src'),
        img.getAttribute('data-lazy'),
        img.getAttribute('data-zoom-src'),
        img.getAttribute('data-hi-res-src'),
        img.getAttribute('data-retina-src')
      ].filter(Boolean);

      for (const src of srcCandidates) {
        if (src && this.isValidImageUrl(src) && !seenUrls.has(src)) {
          try {
            const absoluteUrl = new URL(src, window.location.href).href;
            seenUrls.add(src);
            
            // 콘텐츠 이미지 우선순위 부여
            const imageInfo: ImageInfo = {
              originalUrl: absoluteUrl,
              alt: img.alt || img.title || '',
              width: width,
              height: height,
              isContentImage: isContentSized // 크기 기반 콘텐츠 이미지 판별
            };
            
            // 콘텐츠 이미지는 앞쪽에 배치
            if (isContentSized) {
              images.unshift(imageInfo);
              console.log(`콘텐츠 이미지 추출 (${width}x${height}): ${absoluteUrl}`);
            } else {
              images.push(imageInfo);
              console.log(`일반 이미지 추출 (${width}x${height}): ${absoluteUrl}`);
            }
            
            break; // 첫 번째 유효한 src만 사용
          } catch (error) {
            console.warn('이미지 URL 처리 오류:', src, error);
          }
        }
      }
    }
  }

  private async extractFromPictureTags(container: Element, images: ImageInfo[], seenUrls: Set<string>) {
    const pictures = container.querySelectorAll('picture');
    console.log(`picture 태그 ${pictures.length}개 발견`);

    for (const picture of Array.from(pictures)) {
      // source 태그에서 고품질 이미지 찾기
      const sources = picture.querySelectorAll('source');
      for (const source of Array.from(sources)) {
        const srcset = source.srcset;
        if (srcset) {
          const urls = this.parseSrcset(srcset);
          for (const url of urls) {
            if (this.isValidImageUrl(url) && !seenUrls.has(url)) {
              try {
                const absoluteUrl = new URL(url, window.location.href).href;
                seenUrls.add(url);
                
                images.push({
                  originalUrl: absoluteUrl,
                  alt: picture.querySelector('img')?.alt || '',
                });
                
                console.log(`picture 태그에서 이미지 추출: ${absoluteUrl}`);
                break; // 첫 번째 유효한 URL만 사용
              } catch (error) {
                console.warn('Picture 이미지 URL 처리 오류:', url, error);
              }
            }
          }
        }
      }
    }
  }

  private async extractFromBackgroundImages(container: Element, images: ImageInfo[], seenUrls: Set<string>) {
    const elements = container.querySelectorAll('*');
    let bgImageCount = 0;

    for (const element of Array.from(elements)) {
      const style = window.getComputedStyle(element);
      const bgImage = style.backgroundImage;
      
      if (bgImage && bgImage !== 'none') {
        const urls = this.extractUrlsFromCss(bgImage);
        for (const url of urls) {
          if (this.isValidImageUrl(url) && !seenUrls.has(url)) {
            try {
              const absoluteUrl = new URL(url, window.location.href).href;
              seenUrls.add(url);
              
              images.push({
                originalUrl: absoluteUrl,
                alt: element.getAttribute('aria-label') || element.getAttribute('title') || '',
              });
              
              bgImageCount++;
              console.log(`배경 이미지 추출: ${absoluteUrl}`);
            } catch (error) {
              console.warn('배경 이미지 URL 처리 오류:', url, error);
            }
          }
        }
      }
    }
    
    console.log(`배경 이미지 ${bgImageCount}개 추출`);
  }

  private async extractFromSrcset(container: Element, images: ImageInfo[], seenUrls: Set<string>) {
    const imgsWithSrcset = container.querySelectorAll('img[srcset]');
    console.log(`srcset이 있는 img 태그 ${imgsWithSrcset.length}개 발견`);

    for (const img of Array.from(imgsWithSrcset)) {
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        const urls = this.parseSrcset(srcset);
        // 가장 고화질 이미지 선택 (마지막 URL)
        const highResUrl = urls[urls.length - 1];
        
        if (highResUrl && this.isValidImageUrl(highResUrl) && !seenUrls.has(highResUrl)) {
          try {
            const absoluteUrl = new URL(highResUrl, window.location.href).href;
            seenUrls.add(highResUrl);
            
            images.push({
              originalUrl: absoluteUrl,
              alt: (img as HTMLImageElement).alt || '',
            });
            
            console.log(`srcset에서 고화질 이미지 추출: ${absoluteUrl}`);
          } catch (error) {
            console.warn('Srcset 이미지 URL 처리 오류:', highResUrl, error);
          }
        }
      }
    }
  }

  private async extractFromSvgTags(container: Element, images: ImageInfo[], seenUrls: Set<string>) {
    const svgs = container.querySelectorAll('svg');
    console.log(`SVG 태그 ${svgs.length}개 발견`);

    for (const svg of Array.from(svgs)) {
      // SVG를 data URL로 변환
      try {
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svg);
        
        // SVG 내용으로 중복 체크 (data URL은 매번 달라질 수 있음)
        const svgHash = this.hashCode(svgString);
        const svgIdentifier = `svg_${svgHash}`;
        
        if (!seenUrls.has(svgIdentifier)) {
          seenUrls.add(svgIdentifier);
          
          const dataUrl = `data:image/svg+xml;base64,${btoa(svgString)}`;
          
          images.push({
            originalUrl: dataUrl,
            alt: svg.getAttribute('aria-label') || svg.getAttribute('title') || 'SVG 이미지',
          });
          
          console.log('SVG 이미지 추출:', dataUrl.substring(0, 50) + '...');
        } else {
          console.log('중복 SVG 건너뜀:', svgIdentifier);
        }
      } catch (error) {
        console.warn('SVG 처리 오류:', error);
      }
    }
  }

  private async extractDynamicImages(images: ImageInfo[], seenUrls: Set<string>) {
    // 페이지의 모든 실제 이미지 요소 재확인
    const allImages = document.querySelectorAll('img');
    let dynamicCount = 0;

    for (const img of Array.from(allImages)) {
      if (img.src && this.isValidImageUrl(img.src) && !seenUrls.has(img.src)) {
        try {
          const absoluteUrl = new URL(img.src, window.location.href).href;
          seenUrls.add(img.src);
          
          images.push({
            originalUrl: absoluteUrl,
            alt: img.alt || '',
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height
          });
          
          dynamicCount++;
          console.log(`동적 이미지 추출: ${absoluteUrl}`);
        } catch (error) {
          console.warn('동적 이미지 URL 처리 오류:', img.src, error);
        }
      }
    }
    
    console.log(`동적 이미지 ${dynamicCount}개 추출`);
  }

  private isValidImageUrl(url: string): boolean {
    if (!url) return false;
    
    // 불필요한 이미지 타입 제외
    if (url.startsWith('data:image/svg')) return false; // SVG data URL 제외
    if (url.startsWith('data:')) return false; // 기타 data URL 제외
    if (url.includes('base64')) return false; // base64 이미지 제외
    if (url.includes('blob:')) return false; // blob URL 제외
    
    // 장식용/UI 요소 이미지 필터링
    const excludePatterns = [
      /icon/i, /logo/i, /avatar/i, /profile/i, /badge/i, /button/i,
      /arrow/i, /chevron/i, /dropdown/i, /menu/i, /nav/i, /sidebar/i,
      /cursor/i, /pointer/i, /loading/i, /spinner/i, /dots/i,
      /placeholder/i, /empty/i, /default/i, /fallback/i,
      /1x1/i, /pixel/i, /spacer/i, /divider/i,
      /\.svg$/i // SVG 파일 전체 제외 (콘텐츠 이미지보다는 아이콘일 가능성이 높음)
    ];
    
    for (const pattern of excludePatterns) {
      if (pattern.test(url)) {
        console.log(`장식용 이미지로 판단하여 제외: ${url}`);
        return false;
      }
    }
    
    // 콘텐츠 이미지로 판단되는 확장자
    const contentImageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|avif)(\?|$)/i;
    if (contentImageExtensions.test(url)) return true;
    
    // 확장자가 없어도 콘텐츠 이미지일 수 있는 경우
    const contentIndicators = [
      /photo/i, /picture/i, /image/i, /media/i, /content/i,
      /upload/i, /file/i, /asset/i, /resource/i
    ];
    
    for (const indicator of contentIndicators) {
      if (indicator.test(url)) return true;
    }
    
    // 크기나 해상도 정보가 있는 경우 (콘텐츠 이미지일 가능성 높음)
    if (/\d{3,4}x\d{3,4}/.test(url) || /w_\d{3,}|h_\d{3,}/.test(url)) {
      return true;
    }
    
    return false; // 기본적으로 제외
  }

  private parseSrcset(srcset: string): string[] {
    return srcset
      .split(',')
      .map(src => src.trim().split(' ')[0])
      .filter(Boolean);
  }

  private extractUrlsFromCss(cssValue: string): string[] {
    const urlRegex = /url\(['"]?([^'")\s]+)['"]?\)/g;
    const urls: string[] = [];
    let match;
    
    while ((match = urlRegex.exec(cssValue)) !== null) {
      urls.push(match[1]);
    }
    
    return urls;
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

  private extractImagesFromMarkdown(markdown: string, originalHtml: string): ImageInfo[] {
    const images: ImageInfo[] = [];
    const seenUrls = new Set<string>();

    console.log('Markdown에서 이미지 추출 시작...');

    // 1. Markdown 이미지 태그에서 URL 추출: ![alt](url)
    const markdownImagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;

    while ((match = markdownImagePattern.exec(markdown)) !== null) {
      const alt = match[1] || '';
      const imageUrl = match[2];

      if (imageUrl && this.isValidImageUrl(imageUrl) && !seenUrls.has(imageUrl)) {
        try {
          const absoluteUrl = new URL(imageUrl, window.location.href).href;
          seenUrls.add(imageUrl);

          // HTML에서 이미지 크기 정보 찾기
          const { width, height } = this.getImageDimensionsFromHtml(originalHtml, imageUrl);

          images.push({
            originalUrl: absoluteUrl,
            alt: alt,
            width: width,
            height: height,
            isContentImage: true // Markdown에 포함된 이미지는 모두 콘텐츠 이미지
          });

          console.log(`Markdown 이미지 추출: ${absoluteUrl} (alt: "${alt}")`);
        } catch (error) {
          console.warn('Markdown 이미지 URL 처리 오류:', imageUrl, error);
        }
      }
    }

    // 2. HTML img 태그에서 추가 정보 보완 (Markdown 변환 과정에서 누락될 수 있는 이미지)
    const htmlImages = this.extractImagesFromHtmlSync(originalHtml);
    for (const htmlImage of htmlImages) {
      if (!seenUrls.has(htmlImage.originalUrl) && this.isValidImageUrl(htmlImage.originalUrl)) {
        seenUrls.add(htmlImage.originalUrl);
        images.push(htmlImage);
        console.log(`HTML에서 추가 이미지 추출: ${htmlImage.originalUrl}`);
      }
    }

    console.log(`이미지 추출 완료: ${images.length}개`);
    return images;
  }

  private getImageDimensionsFromHtml(html: string, imageUrl: string): { width?: number; height?: number } {
    const div = document.createElement('div');
    div.innerHTML = html;
    
    const imgs = div.querySelectorAll('img');
    for (const img of Array.from(imgs)) {
      const src = img.src || img.dataset.src || img.getAttribute('data-src');
      if (src && (src === imageUrl || src.includes(imageUrl) || imageUrl.includes(src))) {
        return {
          width: img.naturalWidth || img.width || parseInt(img.getAttribute('width') || '0') || undefined,
          height: img.naturalHeight || img.height || parseInt(img.getAttribute('height') || '0') || undefined
        };
      }
    }
    
    return {};
  }

  private extractImagesFromHtmlSync(html: string): ImageInfo[] {
    const div = document.createElement('div');
    div.innerHTML = html;
    const images: ImageInfo[] = [];
    const seenUrls = new Set<string>();

    const imgs = div.querySelectorAll('img');
    for (const img of Array.from(imgs)) {
      const srcCandidates = [
        img.src,
        img.dataset.src,
        img.dataset.lazySrc,
        img.dataset.original,
        img.getAttribute('data-src')
      ].filter(Boolean);

      for (const src of srcCandidates) {
        if (src && this.isValidImageUrl(src) && !seenUrls.has(src)) {
          try {
            const absoluteUrl = new URL(src, window.location.href).href;
            seenUrls.add(src);
            
            const width = img.naturalWidth || img.width || parseInt(img.getAttribute('width') || '0');
            const height = img.naturalHeight || img.height || parseInt(img.getAttribute('height') || '0');
            
            images.push({
              originalUrl: absoluteUrl,
              alt: img.alt || img.title || '',
              width: width || undefined,
              height: height || undefined,
              isContentImage: width >= 200 && height >= 150
            });
            
            break;
          } catch (error) {
            console.warn('HTML 이미지 URL 처리 오류:', src, error);
          }
        }
      }
    }

    return images;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit integer로 변환
    }
    return hash;
  }

  async extractElementContent(element: HTMLElement): Promise<PageContent> {
    // 요소를 복제하여 작업
    const clonedElement = element.cloneNode(true) as HTMLElement;
    
    // 불필요한 요소 제거
    const unwantedSelectors = [
      'script', 'style', 'noscript', 'iframe', 
      '.ads', '.advertisement', '.social-share',
      '[class*="popup"]', '[class*="modal"]'
    ];
    
    unwantedSelectors.forEach(selector => {
      clonedElement.querySelectorAll(selector).forEach(el => el.remove());
    });
    
    // HTML을 마크다운으로 변환
    const html = clonedElement.outerHTML;
    let markdown = this.turndown.turndown(html);
    
    // 링크 처리
    markdown = LinkProcessor.processLinks(markdown);
    
    const images = await this.extractImages(html);
    
    // 제목 추출 (요소 내의 첫 번째 heading 또는 document title)
    const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
    const title = heading?.textContent?.trim() || document.title;
    
    return {
      title,
      content: markdown,
      url: window.location.href,
      images,
      selection: ''
    };
  }
}
