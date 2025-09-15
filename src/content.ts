// src/content.ts
import { ContentExtractor } from './features/content_extraction/extractor';

// Content script that runs on every page
class OutlineClipper {
  private extractor: ContentExtractor;
  private selectionMode: boolean = false;
  private selectionModeData: any = null;
  private hoveredElement: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private toolbarButton: HTMLElement | null = null;
  private selectedElement: HTMLElement | null = null;

  constructor() {
    this.extractor = new ContentExtractor();
    this.init();
  }

  private init() {
    console.log('Outline Clipper content script loaded');
    this.setupMessageListener();
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sendResponse);
      return true; // Will respond asynchronously
    });
  }

  private async handleMessage(request: any, sendResponse: Function) {
    console.log('Message received:', request.action);

    switch (request.action) {
      case 'extractContent':
        try {
          const options = request.options || {
            includeImages: true,
            uploadImages: true,
            simplifyContent: false,
            addSourceUrl: true,
            addTimestamp: true,
            addHighlights: false,
            formatStyle: 'markdown',
            formatType: 'article'
          };
          const content = await this.extractor.extractContent(options);
          sendResponse({ success: true, content });
        } catch (error: any) {
          console.error('Content extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'startSelection':
        this.startSelectionMode(request.data);
        sendResponse({ success: true });
        break;

      case 'startEvernoteSelection':
        this.startEvernoteSelectionMode(request.data);
        sendResponse({ success: true });
        break;

      case 'captureScreenshot':
        try {
          const screenshot = await this.captureVisibleArea();
          sendResponse({ success: true, screenshot });
        } catch (error: any) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  }

  private async captureVisibleArea(): Promise<string> {
    // 스크린샷 요청을 background로 전달
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'captureScreenshot' }, (response) => {
        // runtime.lastError 체크
        if (chrome.runtime.lastError) {
          console.error('Screenshot error:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.success) {
          resolve(response.screenshot);
        } else {
          reject(new Error(response?.error || 'Screenshot failed'));
        }
      });
    });
  }

  private startSelectionMode(data: any) {
    console.log('텍스트 선택 모드 시작');
    this.selectionModeData = data;
    this.showSelectionPrompt();
  }

  private showSelectionPrompt() {
    const prompt = document.createElement('div');
    prompt.textContent = '텍스트를 드래그하여 선택한 후 Enter를 누르세요 (ESC: 취소)';
    prompt.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #667eea;
      color: white;
      padding: 15px 30px;
      border-radius: 30px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
      z-index: 999999;
      animation: slideDown 0.3s ease-out;
    `;
    document.body.appendChild(prompt);

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const selection = window.getSelection();
        if (selection && selection.toString().trim()) {
          const selectedText = selection.toString();
          chrome.runtime.sendMessage({
            action: 'clipSelectedContent',
            data: {
              ...this.selectionModeData,
              content: selectedText,
              type: 'text'
            }
          });
          prompt.remove();
          document.removeEventListener('keydown', handleKeyPress);
        }
      } else if (e.key === 'Escape') {
        prompt.remove();
        document.removeEventListener('keydown', handleKeyPress);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
  }

  private removeHighlight() {
    document.querySelectorAll('.outline-clipper-highlight').forEach(el => {
      el.classList.remove('outline-clipper-highlight');
    });
  }

  private startEvernoteSelectionMode(data: any) {
    this.selectionMode = true;
    this.selectionModeData = data;
    this.selectedElement = null;
    this.hoveredElement = null;

    // 스타일 추가
    this.addSelectionStyles();

    // 안내 메시지 생성
    this.createSelectionGuide();

    // 이벤트 리스너 추가
    this.addSelectionEventListeners();
  }

  private createSelectionGuide() {
    // 상단 안내 메시지
    const guide = document.createElement('div');
    guide.id = 'outline-clipper-selection-guide';
    guide.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      color: #333;
      padding: 16px 32px;
      border-radius: 30px;
      z-index: 999997;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      animation: slideDown 0.5s ease-out;
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    guide.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <polyline points="9 11 12 14 15 10"/>
      </svg>
      <span>마우스를 올리고 클릭하여 저장할 영역을 선택하세요</span>
      <span style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">ESC 취소</span>
    `;
    document.body.appendChild(guide);
    this.toolbarButton = guide;
  }

  private addSelectionStyles() {
    const style = document.createElement('style');
    style.id = 'outline-clipper-selection-style';
    style.textContent = `
      @keyframes slideDown {
        from {
          transform: translateX(-50%) translateY(-100px);
          opacity: 0;
        }
        to {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
        }
      }

      @keyframes fadeInScale {
        from {
          transform: translate(-50%, -50%) scale(0.8);
          opacity: 0;
        }
        to {
          transform: translate(-50%, -50%) scale(1);
          opacity: 1;
        }
      }

      @keyframes fadeOutScale {
        from {
          transform: translate(-50%, -50%) scale(1);
          opacity: 1;
        }
        to {
          transform: translate(-50%, -50%) scale(0.8);
          opacity: 0;
        }
      }

      .outline-clipper-hover {
        outline: 3px solid #667eea !important;
        outline-offset: 2px !important;
        background-color: rgba(102, 126, 234, 0.1) !important;
        cursor: pointer !important;
        position: relative !important;
        z-index: 999991 !important;
        transition: all 0.2s ease !important;
      }

      .outline-clipper-hover:hover {
        outline: 4px solid #5a67d8 !important;
        background-color: rgba(102, 126, 234, 0.15) !important;
      }
    `;
    document.head.appendChild(style);
  }

  private addSelectionEventListeners() {
    // 호버 이벤트
    document.addEventListener('mouseover', this.handleHover, true);
    document.addEventListener('mouseout', this.handleMouseOut, true);

    // 클릭 이벤트
    document.addEventListener('click', this.handleElementClick, true);

    // 키보드 이벤트
    document.addEventListener('keydown', this.handleKeyPress);
  }

  private handleHover = (e: MouseEvent) => {
    if (!this.selectionMode) return;

    const target = e.target as HTMLElement;
    if (this.isOverlayElement(target)) return;

    // 이전 호버 제거
    if (this.hoveredElement && this.hoveredElement !== target) {
      this.hoveredElement.classList.remove('outline-clipper-hover');
    }

    // 새 호버 추가
    target.classList.add('outline-clipper-hover');
    this.hoveredElement = target;
  };

  private handleMouseOut = (e: MouseEvent) => {
    if (!this.selectionMode) return;

    const target = e.target as HTMLElement;
    if (target === this.hoveredElement) {
      target.classList.remove('outline-clipper-hover');
      this.hoveredElement = null;
    }
  };

  private handleElementClick = async (e: MouseEvent) => {
    if (!this.selectionMode) return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;

    // 안내 메시지나 오버레이 요소는 무시
    if (this.isOverlayElement(target)) return;

    // 요소 선택
    this.selectedElement = target;

    // 호버 효과 제거
    if (this.hoveredElement) {
      this.hoveredElement.classList.remove('outline-clipper-hover');
    }

    // 선택 완료 메시지 표시
    this.showSelectionCompleteMessage();

    // 선택 모드 종료
    this.stopSelectionMode();

    // 콘텐츠 추출
    const content = await this.extractor.extractElementContent(this.selectedElement);

    // 이미지 업로드 진행 상황 표시
    this.showProgressMessage('이미지 업로드 중...');

    // 팝업으로 전송
    if (this.selectionModeData?.temporary) {
      chrome.runtime.sendMessage({
        action: 'clipSelectedContent',
        content: content,
        temporary: true
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Clip error:', chrome.runtime.lastError);
          this.showErrorMessage(chrome.runtime.lastError.message || 'Communication error');
          return;
        }
        // 팝업 열기
        chrome.runtime.sendMessage({ action: 'openPopup' }, () => {
          // 에러 무시 (팝업이 이미 열려있을 수 있음)
          if (chrome.runtime.lastError) {
            console.log('Popup already open or cannot open');
          }
        });
      });
    } else {
      // 바로 저장
      chrome.runtime.sendMessage({
        action: 'clipSelectedContent',
        content: content,
        collectionId: this.selectionModeData.collectionId,
        parentDocumentId: this.selectionModeData.parentDocumentId,
        options: this.selectionModeData.options
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Save error:', chrome.runtime.lastError);
          this.showErrorMessage(chrome.runtime.lastError.message || 'Communication error');
          return;
        }
        if (response?.success) {
          this.showCompleteMessage();
        } else {
          this.showErrorMessage(response?.error || '저장 실패');
        }
      });
    }
  };

  private handleKeyPress = (e: KeyboardEvent) => {
    if (!this.selectionMode) return;

    if (e.key === 'Escape') {
      this.stopSelectionMode();
    }
  };

  private showSelectionCompleteMessage() {
    const message = this.createMessage('선택 완료!', '#667eea');
    document.body.appendChild(message);

    setTimeout(() => {
      message.style.animation = 'fadeOutScale 0.3s ease-out';
      setTimeout(() => message.remove(), 300);
    }, 400);
  }

  private showProgressMessage(text: string) {
    const existingMsg = document.getElementById('outline-clipper-progress-message');
    if (existingMsg) existingMsg.remove();

    const message = this.createMessage(text, '#667eea');
    message.id = 'outline-clipper-progress-message';
    document.body.appendChild(message);
  }

  private showCompleteMessage() {
    const existingMsg = document.getElementById('outline-clipper-progress-message');
    if (existingMsg) existingMsg.remove();

    const message = this.createMessage('저장 완료!', '#28a745');
    document.body.appendChild(message);

    setTimeout(() => {
      message.style.animation = 'fadeOutScale 0.3s ease-out';
      setTimeout(() => message.remove(), 300);
    }, 1500);
  }

  private showErrorMessage(error: string) {
    const existingMsg = document.getElementById('outline-clipper-progress-message');
    if (existingMsg) existingMsg.remove();

    const message = this.createMessage(`오류: ${error}`, '#dc3545');
    document.body.appendChild(message);

    setTimeout(() => {
      message.style.animation = 'fadeOutScale 0.3s ease-out';
      setTimeout(() => message.remove(), 300);
    }, 3000);
  }

  private createMessage(text: string, color: string): HTMLElement {
    const message = document.createElement('div');
    message.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: ${color};
      color: white;
      padding: 24px 48px;
      border-radius: 12px;
      z-index: 999999;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 18px;
      font-weight: 600;
      animation: fadeInScale 0.3s ease-out;
      display: flex;
      align-items: center;
      gap: 16px;
    `;

    message.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
      <span>${text}</span>
    `;

    return message;
  }

  private isOverlayElement(element: HTMLElement): boolean {
    return element === this.overlay ||
           element === this.toolbarButton ||
           element.id === 'outline-clipper-selection-guide' ||
           element.closest('#outline-clipper-selection-guide') !== null;
  }

  private stopSelectionMode() {
    this.selectionMode = false;
    this.selectionModeData = null;

    // 호버 효과 제거
    if (this.hoveredElement) {
      this.hoveredElement.classList.remove('outline-clipper-hover');
      this.hoveredElement = null;
    }

    // UI 요소 제거
    this.toolbarButton?.remove();
    this.toolbarButton = null;

    // 스타일 제거
    document.getElementById('outline-clipper-selection-style')?.remove();

    // 이벤트 리스너 제거
    document.removeEventListener('mouseover', this.handleHover, true);
    document.removeEventListener('mouseout', this.handleMouseOut, true);
    document.removeEventListener('click', this.handleElementClick, true);
    document.removeEventListener('keydown', this.handleKeyPress);
  }
}

// Initialize the clipper
new OutlineClipper();