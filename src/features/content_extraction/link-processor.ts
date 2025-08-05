// src/features/content_extraction/link-processor.ts

export class LinkProcessor {
  
  /**
   * 링크를 Outline 지원 태그로 변환
   */
  static processLinks(markdown: string): string {
    // 마크다운 링크 패턴 찾기: [텍스트](URL)
    const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
    
    return markdown.replace(linkPattern, (match, text, url) => {
      return this.convertLinkToOutlineTag(text, url) || match;
    });
  }

  /**
   * URL을 분석하여 적절한 Outline 태그로 변환
   */
  private static convertLinkToOutlineTag(text: string, url: string): string | null {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      
      // YouTube 처리
      if (this.isYouTube(domain, urlObj)) {
        const videoId = this.extractYouTubeVideoId(url);
        if (videoId) {
          return `@[youtube](${videoId})`;
        }
      }
      
      // Twitter/X 처리
      if (this.isTwitter(domain)) {
        const tweetId = this.extractTwitterTweetId(urlObj);
        if (tweetId) {
          return `@[tweet](${tweetId})`;
        }
      }
      
      // CodePen 처리
      if (this.isCodePen(domain)) {
        const penId = this.extractCodePenId(urlObj);
        if (penId) {
          return `@[codepen](${penId})`;
        }
      }
      
      // GitHub Gist 처리
      if (this.isGitHubGist(domain, urlObj)) {
        const gistId = this.extractGistId(urlObj);
        if (gistId) {
          return `@[gist](${gistId})`;
        }
      }
      
      // Figma 처리
      if (this.isFigma(domain)) {
        return `@[figma](${url})`;
      }
      
      // Miro 처리
      if (this.isMiro(domain)) {
        return `@[miro](${url})`;
      }
      
      // Google Maps 처리
      if (this.isGoogleMaps(domain, urlObj)) {
        return `@[googlemaps](${url})`;
      }
      
      // Vimeo 처리
      if (this.isVimeo(domain)) {
        const videoId = this.extractVimeoVideoId(urlObj);
        if (videoId) {
          return `@[vimeo](${videoId})`;
        }
      }
      
      // 일반 링크는 그대로 반환
      return `[${text}](${url})`;
      
    } catch (error) {
      // URL 파싱 실패 시 원본 반환
      return null;
    }
  }

  // YouTube 감지
  private static isYouTube(domain: string, url: URL): boolean {
    return domain.includes('youtube.com') || domain.includes('youtu.be');
  }

  // YouTube 비디오 ID 추출
  private static extractYouTubeVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/v\/([^&\n?#]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }

  // Twitter/X 감지
  private static isTwitter(domain: string): boolean {
    return domain.includes('twitter.com') || domain.includes('x.com');
  }

  // Twitter 트윗 ID 추출
  private static extractTwitterTweetId(url: URL): string | null {
    const pathMatch = url.pathname.match(/\/status\/(\d+)/);
    return pathMatch ? pathMatch[1] : null;
  }

  // CodePen 감지
  private static isCodePen(domain: string): boolean {
    return domain.includes('codepen.io');
  }

  // CodePen ID 추출
  private static extractCodePenId(url: URL): string | null {
    const pathMatch = url.pathname.match(/\/pen\/([^\/]+)/);
    return pathMatch ? pathMatch[1] : null;
  }

  // GitHub Gist 감지
  private static isGitHubGist(domain: string, url: URL): boolean {
    return domain.includes('gist.github.com');
  }

  // GitHub Gist ID 추출
  private static extractGistId(url: URL): string | null {
    const pathMatch = url.pathname.match(/\/([^\/]+)\/([a-f0-9]+)/);
    return pathMatch ? pathMatch[2] : null;
  }

  // Figma 감지
  private static isFigma(domain: string): boolean {
    return domain.includes('figma.com');
  }

  // Miro 감지
  private static isMiro(domain: string): boolean {
    return domain.includes('miro.com');
  }

  // Google Maps 감지
  private static isGoogleMaps(domain: string, url: URL): boolean {
    return domain.includes('maps.google.com') || 
           domain.includes('google.com') && url.pathname.includes('/maps');
  }

  // Vimeo 감지
  private static isVimeo(domain: string): boolean {
    return domain.includes('vimeo.com');
  }

  // Vimeo 비디오 ID 추출
  private static extractVimeoVideoId(url: URL): string | null {
    const pathMatch = url.pathname.match(/\/(\d+)/);
    return pathMatch ? pathMatch[1] : null;
  }

  /**
   * HTML에서 링크를 찾아 처리
   */
  static processLinksInHtml(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    
    const links = div.querySelectorAll('a[href]');
    
    links.forEach(link => {
      const href = link.getAttribute('href');
      const text = link.textContent || link.getAttribute('title') || href;
      
      if (href) {
        const outlineTag = this.convertLinkToOutlineTag(text || '', href);
        if (outlineTag && outlineTag !== `[${text}](${href})` && outlineTag.startsWith('@[')) {
          // Outline 임베드 태그로 변환된 경우만 교체
          const span = document.createElement('span');
          span.textContent = outlineTag;
          span.className = 'outline-embed-tag';
          link.parentNode?.replaceChild(span, link);
        }
      }
    });
    
    return div.innerHTML;
  }

  /**
   * 임베드 가능한 링크인지 확인
   */
  static isEmbeddableLink(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      
      return this.isYouTube(domain, urlObj) ||
             this.isTwitter(domain) ||
             this.isCodePen(domain) ||
             this.isGitHubGist(domain, urlObj) ||
             this.isFigma(domain) ||
             this.isMiro(domain) ||
             this.isVimeo(domain);
    } catch {
      return false;
    }
  }
}