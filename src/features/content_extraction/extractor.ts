
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

        // GitHub의 data-canonical-src를 우선 사용, 없으면 일반 src 속성들 확인
        let src = img.getAttribute('data-canonical-src') ||
                  img.src ||
                  img.dataset.src ||
                  img.dataset.lazySrc ||
                  img.getAttribute('data-lazy-src') ||
                  '';

        console.log(`Turndown 이미지 처리: src="${src}", alt="${alt}"`);
        console.log(`  - img.src: ${img.src}`);
        console.log(`  - data-canonical-src: ${img.getAttribute('data-canonical-src')}`);
        console.log(`  - dataset.src: ${img.dataset.src}`);

        // 상대 경로를 절대 경로로 변환
        if (src) {
          try {
            // URL 객체를 사용하여 상대 경로를 절대 경로로 변환
            const absoluteUrl = new URL(src, window.location.href).href;
            src = absoluteUrl;
            console.log(`  -> 최종 URL: ${src}`);
          } catch (error) {
            // URL 변환 실패 시 원본 유지
            console.warn('이미지 URL 변환 실패:', src, error);
          }
        } else {
          console.warn('이미지 src가 비어있음:', img);
        }

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
    // GitHub README 페이지 특별 처리
    if (this.isGitHubReadme()) {
      return this.extractGitHubReadme(options);
    }

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

    // Markdown 내 상대 경로 이미지 URL을 절대 경로로 변환
    markdown = this.convertRelativeImageUrls(markdown);

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

    // Markdown 내 상대 경로 이미지 URL을 절대 경로로 변환
    markdown = this.convertRelativeImageUrls(markdown);

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
      
      console.log(`img.src:`, img);
      
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
              markdownUrl: absoluteUrl,  // HTML 이미지도 markdownUrl 설정
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
                  markdownUrl: absoluteUrl,  // picture 태그도 markdownUrl 설정
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
                markdownUrl: absoluteUrl,  // background-image도 markdownUrl 설정
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
              markdownUrl: absoluteUrl,  // srcset 이미지도 markdownUrl 설정
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
            markdownUrl: dataUrl,  // SVG 이미지도 markdownUrl 설정
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
            markdownUrl: absoluteUrl,  // 동적 로딩 이미지도 markdownUrl 설정
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

    // GitHub 이미지는 항상 유효한 것으로 처리
    if (url.includes('github.com') || url.includes('githubusercontent.com')) {
      console.log(`GitHub 이미지로 인식: ${url.substring(0, 100)}...`);
      return true;
    }

    // 불필요한 이미지 타입 제외
    if (url.startsWith('data:image/svg')) return false; // SVG data URL 제외
    if (url.startsWith('data:')) return false; // 기타 data URL 제외
    if (url.includes('base64')) return false; // base64 이미지 제외
    if (url.includes('blob:')) return false; // blob URL 제외

    // 장식용/UI 요소 이미지 필터링 (GitHub 이미지가 아닌 경우만)
    const excludePatterns = [
      /icon/i, /logo/i, /avatar/i, /profile/i, /badge/i, /button/i,
      /arrow/i, /chevron/i, /dropdown/i, /menu/i, /nav/i, /sidebar/i,
      /cursor/i, /pointer/i, /loading/i, /spinner/i, /dots/i,
      /placeholder/i, /empty/i, /default/i, /fallback/i,
      /1x1/i, /pixel/i, /spacer/i, /divider/i
    ];

    // SVG 파일은 GitHub에서는 허용
    if (url.endsWith('.svg') && !url.includes('github')) {
      console.log(`SVG 파일 제외 (GitHub 아님): ${url}`);
      return false;
    }

    for (const pattern of excludePatterns) {
      if (pattern.test(url)) {
        console.log(`장식용 이미지로 판단하여 제외: ${url}`);
        return false;
      }
    }

    // 콘텐츠 이미지로 판단되는 확장자
    const contentImageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|avif|svg)(\?|$)/i;
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

  private async fetchGitHubRawMarkdown(): Promise<string | null> {
    try {
      // GitHub URL 파싱
      const pathname = window.location.pathname;
      console.log('GitHub pathname:', pathname);

      // 방법 1: raw.githubusercontent.com URL 생성
      let rawUrl: string | null = null;

      // 저장소 메인 페이지 (README.md)
      const repoMatch = pathname.match(/^\/([^\/]+)\/([^\/]+)\/?$/);
      if (repoMatch) {
        const [, owner, repo] = repoMatch;
        // 기본 브랜치 찾기
        const defaultBranch = this.getDefaultBranch();
        rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/README.md`;
      }

      // blob 페이지 (특정 파일)
      const blobMatch = pathname.match(/^\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/);
      if (blobMatch) {
        const [, owner, repo, branch, path] = blobMatch;
        rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      }

      if (!rawUrl) {
        console.log('Raw URL 생성 실패');
        return null;
      }

      console.log('Raw URL 생성:', rawUrl);

      // background script를 통해 raw 콘텐츠 가져오기
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'fetchUrl', url: rawUrl },
          (response) => {
            if (response && response.success) {
              console.log('Raw 마크다운 획득 성공');
              resolve(response.content);
            } else {
              console.error('Raw 마크다운 획득 실패:', response?.error);
              resolve(null);
            }
          }
        );
      });
    } catch (error) {
      console.error('GitHub raw 마크다운 fetch 오류:', error);
      return null;
    }
  }

  private getDefaultBranch(): string {
    // GitHub 페이지에서 기본 브랜치 찾기
    const branchButton = document.querySelector('[data-hotkey="w"]');
    if (branchButton) {
      const branchText = branchButton.textContent?.trim();
      if (branchText) {
        return branchText;
      }
    }

    // 대체 방법: meta 태그에서 찾기
    const metaTag = document.querySelector('meta[name="octolytics-dimension-repository_default_branch"]');
    if (metaTag) {
      const branch = metaTag.getAttribute('content');
      if (branch) {
        return branch;
      }
    }

    // 기본값
    return 'main';
  }

  private processGitHubRawMarkdown(markdown: string): { markdown: string; images: ImageInfo[] } {
    const images: ImageInfo[] = [];
    const seenUrls = new Set<string>();

    console.log('GitHub Raw 마크다운 처리 시작');

    // GitHub 저장소 정보 파싱
    const pathname = window.location.pathname;
    const repoMatch = pathname.match(/^\/([^\/]+)\/([^\/]+)/);

    if (!repoMatch) {
      console.warn('GitHub 저장소 정보를 파싱할 수 없음');
      return { markdown, images: [] };
    }

    const [, owner, repo] = repoMatch;
    const branch = this.getDefaultBranch();

    // 현재 파일의 디렉토리 경로 계산
    let currentDir = '';
    const blobMatch = pathname.match(/^\/[^\/]+\/[^\/]+\/blob\/[^\/]+\/(.+)$/);
    if (blobMatch) {
      const filePath = blobMatch[1];
      currentDir = filePath.substring(0, filePath.lastIndexOf('/'));
    }

    // Markdown 이미지 패턴: ![alt](url)
    const processedMarkdown = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, imageUrl) => {
      console.log(`발견된 이미지: alt="${alt}", url="${imageUrl}"`);

      // 이미 절대 URL인 경우
      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        if (!seenUrls.has(imageUrl)) {
          seenUrls.add(imageUrl);
          images.push({
            originalUrl: imageUrl,
            markdownUrl: imageUrl,
            alt: alt || '',
            isContentImage: true
          });
          console.log(`절대 URL 이미지 추가: ${imageUrl}`);
        }
        return match; // 원본 그대로 반환
      }

      // 상대 경로를 절대 경로로 변환
      let absoluteUrl: string;

      try {
        if (imageUrl.startsWith('/')) {
          // 저장소 루트 기준 경로
          absoluteUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${imageUrl}`;
        } else {
          // 현재 디렉토리 기준 상대 경로
          if (currentDir) {
            // 경로 정규화 (../ 처리 등)
            const normalizedPath = this.normalizePath(`${currentDir}/${imageUrl}`);
            absoluteUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${normalizedPath}`;
          } else {
            absoluteUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${imageUrl}`;
          }
        }

        if (!seenUrls.has(absoluteUrl)) {
          seenUrls.add(absoluteUrl);

          // 이미지 정보 저장 (원본 상대 경로와 절대 URL 모두 저장)
          images.push({
            originalUrl: absoluteUrl,       // 업로드할 절대 URL
            markdownUrl: imageUrl,          // 마크다운 내 원본 경로 (교체용)
            alt: alt || '',
            isContentImage: true
          });

          console.log(`상대 경로 이미지 변환:
            - 원본: ${imageUrl}
            - 절대 URL: ${absoluteUrl}`);
        }

        // 마크다운 내용을 절대 URL로 교체
        return `![${alt}](${absoluteUrl})`;

      } catch (error) {
        console.warn('이미지 URL 변환 실패:', imageUrl, error);
        return match; // 변환 실패 시 원본 유지
      }
    });

    console.log(`GitHub 마크다운 처리 완료: ${images.length}개 이미지 추출`);

    return {
      markdown: processedMarkdown,
      images: images
    };
  }

  private normalizePath(path: string): string {
    // ../ 와 ./ 를 처리하여 경로 정규화
    const parts = path.split('/');
    const normalized: string[] = [];

    for (const part of parts) {
      if (part === '..') {
        normalized.pop();
      } else if (part !== '.' && part !== '') {
        normalized.push(part);
      }
    }

    return normalized.join('/');
  }

  private extractImagesFromMarkdown(markdown: string, originalHtml: string): ImageInfo[] {
    const images: ImageInfo[] = [];
    const seenUrls = new Set<string>();

    console.log('Markdown에서 이미지 추출 시작...');
    console.log('Markdown 첫 500자:', markdown.substring(0, 500));

    // 1. Markdown 이미지 태그에서 URL 추출: ![alt](url)
    const markdownImagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    let imageCount = 0;

    while ((match = markdownImagePattern.exec(markdown)) !== null) {
      imageCount++;
      const alt = match[1] || '';
      const imageUrl = match[2];

      console.log(`발견된 이미지 #${imageCount}: URL="${imageUrl}", Alt="${alt}"`);

      // GitHub 이미지나 빈 URL 체크를 제거하고 모든 URL 처리
      if (imageUrl) {
        try {
          const absoluteUrl = new URL(imageUrl, window.location.href).href;

          if (!seenUrls.has(absoluteUrl)) {
            seenUrls.add(absoluteUrl);

            // HTML에서 이미지 크기 정보 찾기
            const { width, height } = this.getImageDimensionsFromHtml(originalHtml, imageUrl);

            // imageUrl이 이미 절대경로일 수 있으므로 확인
            const isAbsoluteUrl = imageUrl.startsWith('http://') || imageUrl.startsWith('https://');

            images.push({
              originalUrl: absoluteUrl,  // 절대 경로 (업로드용)
              markdownUrl: isAbsoluteUrl ? imageUrl : absoluteUrl,  // Markdown 내 실제 URL (교체용)
              alt: alt,
              width: width,
              height: height,
              isContentImage: true // Markdown에 포함된 이미지는 모두 콘텐츠 이미지
            });

            console.log(`✅ Markdown 이미지 추출 성공:
              - 원본 Markdown URL: ${imageUrl}
              - 절대경로 여부: ${isAbsoluteUrl}
              - originalUrl (업로드용): ${absoluteUrl}
              - markdownUrl (교체용): ${isAbsoluteUrl ? imageUrl : absoluteUrl}
              - alt: "${alt}"`);
          } else {
            console.log(`⏭️ 중복 이미지 스킵: ${absoluteUrl}`);
          }
        } catch (error) {
          console.warn('Markdown 이미지 URL 처리 오류:', imageUrl, error);
        }
      }
    }

    // 2. HTML img 태그에서 추가 이미지 추출
    // HTML에 있는 이미지들도 모두 포함 (Markdown 변환 과정에서 누락될 수 있는 이미지)
    const htmlImages = this.extractImagesFromHtmlSync(originalHtml);
    console.log(`HTML에서 ${htmlImages.length}개 이미지 발견`);

    for (const htmlImage of htmlImages) {
      if (!seenUrls.has(htmlImage.originalUrl) && this.isValidImageUrl(htmlImage.originalUrl)) {
        seenUrls.add(htmlImage.originalUrl);
        // HTML 이미지도 콘텐츠 이미지로 처리
        htmlImage.isContentImage = true;
        // markdownUrl이 없으면 originalUrl 사용
        if (!htmlImage.markdownUrl) {
          htmlImage.markdownUrl = htmlImage.originalUrl;
        }
        images.push(htmlImage);
        console.log(`HTML에서 이미지 추가: ${htmlImage.originalUrl}`);
      }
    }

    console.log(`\n📊 이미지 추출 완료: ${images.length}개`);
    console.log(`  - Markdown에서 추출: ${images.filter(img => img.isContentImage === true).length}개`);
    console.log(`  - HTML에서 추출: ${images.filter(img => img.isContentImage === false).length}개`);
    console.log(`  - markdownUrl 있음: ${images.filter(img => img.markdownUrl).length}개`);

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
              markdownUrl: absoluteUrl,  // HTML 콘텐츠 이미지도 markdownUrl 설정
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

  private isGitHubReadme(): boolean {
    // GitHub README 페이지인지 확인
    // 1. github.com 도메인
    // 2. README 콘텐츠가 표시되는 페이지 (메인 페이지 또는 blob 페이지)
    if (window.location.hostname !== 'github.com') {
      return false;
    }

    // GitHub 저장소 메인 페이지 또는 파일 보기 페이지
    const hasReadmeContent = document.querySelector('article.markdown-body') ||
                             document.querySelector('#readme') ||
                             document.querySelector('.repository-content .Box-body');

    return !!hasReadmeContent;
  }

  private async extractGitHubReadme(options: ClipperOptions): Promise<PageContent> {
    console.log('GitHub README 페이지 특별 처리 시작');

    // 방법 1: GitHub의 원본 마크다운 가져오기 시도
    const rawMarkdown = await this.fetchGitHubRawMarkdown();

    if (rawMarkdown) {
      console.log('GitHub Raw 마크다운 획득 성공');

      // Raw 마크다운에서 이미지 추출 및 URL 변환
      const { markdown: processedMarkdown, images } = this.processGitHubRawMarkdown(rawMarkdown);

      // 링크 처리
      const finalMarkdown = LinkProcessor.processLinks(processedMarkdown);

      return {
        title: document.title,
        content: finalMarkdown,
        url: window.location.href,
        images: images,
        highlights: options.addHighlights ? this.extractHighlights() : undefined
      };
    }

    // 방법 2: 렌더링된 HTML에서 추출 (fallback)
    console.log('Raw 마크다운 획득 실패, HTML 변환 방식으로 전환');

    const readmeElement = document.querySelector('article.markdown-body') ||
                          document.querySelector('.repository-content .Box-body') ||
                          document.querySelector('#readme');

    if (!readmeElement) {
      console.warn('GitHub README 요소를 찾을 수 없음, 일반 추출로 전환');
      return this.extractContentNormal(options);
    }

    // HTML 콘텐츠 가져오기
    const htmlContent = readmeElement.innerHTML;

    // 링크 처리
    let processedHtml = LinkProcessor.processLinksInHtml(htmlContent);

    // Markdown 변환
    const converter = options.simplifyContent ? this.turndownSimple : this.turndown;
    let markdown = converter.turndown(processedHtml);
    markdown = LinkProcessor.processLinks(markdown);
    markdown = this.convertRelativeImageUrls(markdown);

    // Markdown에서 이미지 추출 (변환된 Markdown에서 실제 이미지 URL 추출)
    const images = this.extractImagesFromMarkdown(markdown, htmlContent);

    // GitHub 특별 처리: data-canonical-src 속성도 확인
    const additionalImages = await this.extractAllImagesFromGitHub(readmeElement);

    // 중복 제거하면서 병합
    const seenUrls = new Set<string>();
    const allImages: ImageInfo[] = [];

    // Markdown에서 추출한 이미지 우선
    for (const img of images) {
      if (!seenUrls.has(img.originalUrl)) {
        seenUrls.add(img.originalUrl);
        allImages.push(img);
      }
    }

    // GitHub에서 추출한 추가 이미지
    for (const img of additionalImages) {
      if (!seenUrls.has(img.originalUrl)) {
        seenUrls.add(img.originalUrl);
        allImages.push(img);
      }
    }

    console.log(`GitHub README에서 ${allImages.length}개 이미지와 함께 문서 생성`);

    return {
      title: document.title,
      content: markdown,
      url: window.location.href,
      images: allImages,
      highlights: options.addHighlights ? this.extractHighlights() : undefined
    };
  }

  private async extractAllImagesFromGitHub(element: Element): Promise<ImageInfo[]> {
    const images: ImageInfo[] = [];
    const seenUrls = new Set<string>();

    // GitHub README의 모든 img 태그에서 추출
    const imgElements = element.querySelectorAll('img');
    console.log(`GitHub README에서 ${imgElements.length}개의 img 태그 발견`);

    for (const img of Array.from(imgElements)) {
      const src = img.src || img.getAttribute('data-canonical-src') || img.dataset.src;
      if (src && !seenUrls.has(src)) {
        try {
          const absoluteUrl = new URL(src, window.location.href).href;
          seenUrls.add(src);

          // GitHub 이미지를 모두 콘텐츠 이미지로 표시
          images.push({
            originalUrl: absoluteUrl,
            markdownUrl: absoluteUrl,  // GitHub 이미지는 이미 절대경로
            alt: img.alt || '',
            width: img.width || undefined,
            height: img.height || undefined,
            isContentImage: true  // 모든 GitHub 이미지를 콘텐츠로 처리
          });

          console.log(`GitHub 이미지 추출: ${src.substring(0, 100)}...`);
        } catch (error) {
          console.warn('GitHub 이미지 URL 처리 오류:', src, error);
        }
      }
    }

    console.log(`GitHub README에서 총 ${images.length}개 이미지 추출 완료`);
    return images;
  }

  private async extractContentNormal(options: ClipperOptions): Promise<PageContent> {
    // 기존 extractContent 로직
    const documentClone = document.cloneNode(true) as Document;

    if (options.removeAds) {
      this.removeAds(documentClone);
    }

    const reader = new Readability(documentClone, {
      keepClasses: options.keepFormatting
    });
    const article = reader.parse();

    if (!article) {
      throw new Error('콘텐츠 추출 실패');
    }

    let processedContent = article.content || '';
    processedContent = LinkProcessor.processLinksInHtml(processedContent);

    const converter = options.simplifyContent ? this.turndownSimple : this.turndown;
    let markdown = converter.turndown(processedContent);
    markdown = LinkProcessor.processLinks(markdown);
    markdown = this.convertRelativeImageUrls(markdown);

    const images = this.extractImagesFromMarkdown(markdown, article.content || '');

    return {
      title: article.title || document.title,
      content: markdown,
      url: window.location.href,
      excerpt: article.excerpt || undefined,
      author: article.byline || undefined,
      publishedDate: this.extractPublishedDate(),
      images,
      highlights: options.addHighlights ? this.extractHighlights() : undefined
    };
  }

  private convertRelativeImageUrls(markdown: string): string {
    // Markdown 이미지 태그에서 상대 URL을 절대 URL로 변환
    // ![alt](url) 패턴
    const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;

    return markdown.replace(imagePattern, (match, alt, url) => {
      // 이미 절대 URL이거나 data URL이면 그대로 유지
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('//')) {
        return match;
      }

      try {
        // 상대 경로를 절대 경로로 변환
        const absoluteUrl = new URL(url, window.location.href).href;
        console.log(`상대 경로 이미지 URL 변환: ${url} -> ${absoluteUrl}`);
        return `![${alt}](${absoluteUrl})`;
      } catch (error) {
        console.warn('이미지 URL 변환 실패:', url, error);
        return match; // 변환 실패 시 원본 유지
      }
    });
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

    // Markdown 내 상대 경로 이미지 URL을 절대 경로로 변환
    markdown = this.convertRelativeImageUrls(markdown);

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
