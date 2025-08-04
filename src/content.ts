
// src/content.ts
import { ContentExtractor } from './features/content_extraction/extractor';
import { ClipperMode } from './types';

class ContentScript {
  private extractor: ContentExtractor;
  private selectionMenu: HTMLElement | null = null;

  constructor() {
    this.extractor = new ContentExtractor();
    this.setupListeners();
    this.setupSelectionMenu();
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

  private setupSelectionMenu() {
    document.addEventListener('mouseup', (e) => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        this.showSelectionMenu(e);
      } else {
        this.hideSelectionMenu();
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (this.selectionMenu && !this.selectionMenu.contains(e.target as Node)) {
        this.hideSelectionMenu();
      }
    });
  }

  private showSelectionMenu(event: MouseEvent) {
    if (!this.selectionMenu) {
      this.createSelectionMenu();
    }

    if (this.selectionMenu) {
      this.selectionMenu.style.left = `${event.pageX}px`;
      this.selectionMenu.style.top = `${event.pageY + 10}px`;
      this.selectionMenu.style.display = 'block';
    }
  }

  private hideSelectionMenu() {
    if (this.selectionMenu) {
      this.selectionMenu.style.display = 'none';
    }
  }

  private createSelectionMenu() {
    this.selectionMenu = document.createElement('div');
    this.selectionMenu.className = 'outline-clipper-selection-menu';
    this.selectionMenu.innerHTML = `
      <button class="outline-clip-selection-btn">
        📎 Outline에 저장
      </button>
    `;

    const button = this.selectionMenu.querySelector('button');
    button?.addEventListener('click', () => {
      this.clipSelection();
      this.hideSelectionMenu();
    });

    document.body.appendChild(this.selectionMenu);
  }

  private async clipSelection() {
    const selection = await this.extractor.extractSelection();
    if (selection) {
      chrome.runtime.sendMessage({
        action: 'clipSelection',
        content: selection
      });
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