
// src/content.ts
import { ContentExtractor } from './features/content_extraction/extractor';
import { ClipperMode } from './types';

class ContentScript {
  private extractor: ContentExtractor;

  constructor() {
    this.extractor = new ContentExtractor();
    this.setupListeners();
  }

  private setupListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sendResponse);
      return true;
    });
  }

  private async handleMessage(request: any, sendResponse: Function) {
    try {
      switch (request.action) {
        case 'extractContent':
          const content = await this.extractor.extractContent(request.options);
          sendResponse({ success: true, content });
          break;

        case 'extractSelection':
          const selection = await this.extractor.extractSelection();
          sendResponse({ success: true, content: selection });
          break;

        case 'highlightContent':
          this.highlightMainContent();
          sendResponse({ success: true });
          break;

        case 'removeHighlight':
          this.removeHighlight();
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: '알 수 없는 액션' });
      }
    } catch (error: any) {
      sendResponse({ success: false, error: error.message });
    }
  }


  private highlightMainContent() {
    const article = document.querySelector('article, main, [role="main"]');
    if (article) {
      article.classList.add('outline-clipper-highlight');
    }
  }

  private removeHighlight() {
    document.querySelectorAll('.outline-clipper-highlight').forEach(el => {
      el.classList.remove('outline-clipper-highlight');
    });
  }
}

// 초기화
new ContentScript();