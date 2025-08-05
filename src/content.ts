
// src/content.ts
import { ContentExtractor } from './features/content_extraction/extractor';
import { ClipperMode } from './types';

class ContentScript {
  private extractor: ContentExtractor;
  private selectionMode: boolean = false;
  private hoveredElement: HTMLElement | null = null;
  private selectedElement: HTMLElement | null = null;
  private selectionModeData: any = null;

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

        case 'startSelectionMode':
          this.startSelectionMode(request);
          sendResponse({ success: true });
          break;

        case 'stopSelectionMode':
          this.stopSelectionMode();
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

  private startSelectionMode(data: any) {
    this.selectionMode = true;
    this.selectionModeData = data;
    
    // 임시 모드인지 확인
    const isTemporary = data.temporary;
    
    // 기존 스타일 요소가 있다면 제거
    const existingStyle = document.getElementById('outline-clipper-selection-style');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // 선택 모드 스타일 추가
    const style = document.createElement('style');
    style.id = 'outline-clipper-selection-style';
    style.textContent = `
      .outline-clipper-hover {
        outline: 2px solid #667eea !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        position: relative !important;
      }
      
      .outline-clipper-hover::before {
        content: '' !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        background: rgba(102, 126, 234, 0.1) !important;
        pointer-events: none !important;
        z-index: 999999 !important;
      }
      
      .outline-clipper-selected {
        outline: 3px solid #667eea !important;
        outline-offset: 3px !important;
        background: rgba(102, 126, 234, 0.05) !important;
      }
      
      body.outline-clipper-selection-mode {
        cursor: crosshair !important;
      }
      
      body.outline-clipper-selection-mode * {
        cursor: crosshair !important;
      }
    `;
    document.head.appendChild(style);
    
    // body에 선택 모드 클래스 추가
    document.body.classList.add('outline-clipper-selection-mode');
    
    // 이벤트 리스너 추가
    document.addEventListener('mouseover', this.handleMouseOver);
    document.addEventListener('mouseout', this.handleMouseOut);
    document.addEventListener('click', this.handleClick);
    document.addEventListener('keydown', this.handleKeyDown);
    
    // 사용자에게 안내 메시지 표시
    this.showSelectionModeMessage();
  }

  private stopSelectionMode() {
    this.selectionMode = false;
    this.selectionModeData = null;
    
    // 스타일 제거
    const style = document.getElementById('outline-clipper-selection-style');
    if (style) {
      style.remove();
    }
    
    // body 클래스 제거
    document.body.classList.remove('outline-clipper-selection-mode');
    
    // 호버 효과 제거
    if (this.hoveredElement) {
      this.hoveredElement.classList.remove('outline-clipper-hover');
      this.hoveredElement = null;
    }
    
    // 선택 효과 제거
    if (this.selectedElement) {
      this.selectedElement.classList.remove('outline-clipper-selected');
      this.selectedElement = null;
    }
    
    // 이벤트 리스너 제거
    document.removeEventListener('mouseover', this.handleMouseOver);
    document.removeEventListener('mouseout', this.handleMouseOut);
    document.removeEventListener('click', this.handleClick);
    document.removeEventListener('keydown', this.handleKeyDown);
    
    // 메시지 제거
    this.hideSelectionModeMessage();
  }

  private handleMouseOver = (e: MouseEvent) => {
    if (!this.selectionMode) return;
    
    const target = e.target as HTMLElement;
    if (!target || target === this.hoveredElement) return;
    
    // 이전 호버 효과 제거
    if (this.hoveredElement) {
      this.hoveredElement.classList.remove('outline-clipper-hover');
    }
    
    // 새 호버 효과 추가
    this.hoveredElement = target;
    target.classList.add('outline-clipper-hover');
  };

  private handleMouseOut = (e: MouseEvent) => {
    if (!this.selectionMode) return;
    
    const target = e.target as HTMLElement;
    if (target === this.hoveredElement) {
      target.classList.remove('outline-clipper-hover');
      this.hoveredElement = null;
    }
  };

  private handleClick = async (e: MouseEvent) => {
    if (!this.selectionMode) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.target as HTMLElement;
    this.selectedElement = target;
    
    // 선택한 요소의 콘텐츠 추출
    const content = await this.extractor.extractElementContent(target);
    
    if (this.selectionModeData?.temporary) {
      // 임시 모드일 때는 팝업으로 선택된 요소 전송
      chrome.runtime.sendMessage({
        action: 'elementSelected',
        content: content
      });
      
      // 선택 모드 종료하지 않고 상태만 업데이트
      this.hideSelectionModeMessage();
      this.showSelectedMessage();
    } else {
      // 기존 방식: 바로 저장
      chrome.runtime.sendMessage({
        action: 'clipSelectedContent',
        content: content,
        collectionId: this.selectionModeData.collectionId,
        parentDocumentId: this.selectionModeData.parentDocumentId,
        options: this.selectionModeData.options
      });
      
      // 선택 모드 종료
      this.stopSelectionMode();
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.selectionMode) return;
    
    // ESC 키로 선택 모드 취소
    if (e.key === 'Escape') {
      this.stopSelectionMode();
    }
  };

  private showSelectionModeMessage() {
    const message = document.createElement('div');
    message.id = 'outline-clipper-selection-message';
    message.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 24px;
      border-radius: 24px;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      z-index: 999999;
      animation: slideDown 0.3s ease-out;
    `;
    message.textContent = '클릭하여 영역을 선택하세요 (ESC로 취소)';
    
    // 애니메이션 스타일 추가
    const animStyle = document.createElement('style');
    animStyle.textContent = `
      @keyframes slideDown {
        from {
          transform: translateX(-50%) translateY(-20px);
          opacity: 0;
        }
        to {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(animStyle);
    document.body.appendChild(message);
  }

  private hideSelectionModeMessage() {
    const message = document.getElementById('outline-clipper-selection-message');
    if (message) {
      message.remove();
    }
  }

  private showSelectedMessage() {
    const message = document.createElement('div');
    message.id = 'outline-clipper-selection-message';
    message.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
      color: white;
      padding: 12px 24px;
      border-radius: 24px;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      z-index: 999999;
      animation: slideDown 0.3s ease-out;
    `;
    message.textContent = '✅ 영역이 선택되었습니다. 팝업에서 저장하세요.';
    
    document.body.appendChild(message);
  }
}

// 초기화
new ContentScript();