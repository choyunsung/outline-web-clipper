// src/content.ts
import { ContentExtractor } from './features/content_extraction/extractor';
import { ClipperMode } from './types';

class ContentScript {
  private extractor: ContentExtractor;
  private selectionMode: boolean = false;
  private hoveredElement: HTMLElement | null = null;
  private selectedElement: HTMLElement | null = null;
  private selectedElements: HTMLElement[] = [];
  private selectionModeData: any = null;

  // Evernote 스타일 선택 모드
  private isDragging: boolean = false;
  private dragStart: { x: number; y: number } | null = null;
  private selectionBox: HTMLDivElement | null = null;
  private overlay: HTMLDivElement | null = null;
  private toolbar: HTMLDivElement | null = null;
  private toolbarButton: HTMLDivElement | null = null;

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
          this.startEvernoteSelectionMode(request);
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

  private startEvernoteSelectionMode(data: any) {
    this.selectionMode = true;
    this.selectionModeData = data;
    this.selectedElements = [];
    this.isDragging = false;
    this.hoveredElement = null;

    // 스타일 추가 (먼저 추가)
    this.addSelectionStyles();

    // 안내 메시지 생성
    this.createSelectionGuide();

    // 이벤트 리스너 추가
    this.addSelectionEventListeners();
  }

  private createOverlay() {
    // 투명 오버레이 생성 (배경 없이)
    this.overlay = document.createElement('div');
    this.overlay.id = 'outline-clipper-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 999990;
      pointer-events: none;
    `;
    document.body.appendChild(this.overlay);
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

      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
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

      .outline-clipper-selected {
        position: relative !important;
        z-index: 999992 !important;
      }

      .outline-clipper-selected::after {
        content: '' !important;
        position: absolute !important;
        top: -3px !important;
        left: -3px !important;
        right: -3px !important;
        bottom: -3px !important;
        border: 3px solid #28a745 !important;
        border-radius: 8px !important;
        background: rgba(40, 167, 69, 0.15) !important;
        pointer-events: none !important;
      }

      .outline-clipper-selected::before {
        content: '✓' !important;
        position: absolute !important;
        top: -15px !important;
        right: -15px !important;
        width: 30px !important;
        height: 30px !important;
        background: #28a745 !important;
        color: white !important;
        border-radius: 50% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 18px !important;
        font-weight: bold !important;
        z-index: 999993 !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2) !important;
      }

      #outline-clipper-selection-box {
        position: fixed !important;
        border: 2px dashed #667eea !important;
        background: rgba(102, 126, 234, 0.1) !important;
        pointer-events: none !important;
        z-index: 999995 !important;
        border-radius: 4px !important;
      }

      .outline-clipper-toolbar {
        position: fixed !important;
        bottom: 30px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: white !important;
        border-radius: 12px !important;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3) !important;
        padding: 10px !important;
        display: flex !important;
        gap: 10px !important;
        z-index: 999999 !important;
        animation: slideUp 0.3s ease-out !important;
      }

      @keyframes slideUp {
        from {
          transform: translateX(-50%) translateY(100px);
          opacity: 0;
        }
        to {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
        }
      }

      .outline-clipper-toolbar button {
        padding: 10px 20px !important;
        border: none !important;
        border-radius: 8px !important;
        font-size: 14px !important;
        font-weight: 500 !important;
        cursor: pointer !important;
        transition: all 0.2s !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }

      .outline-clipper-toolbar button:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
      }

      .outline-clipper-toolbar .save-btn {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: white !important;
      }

      .outline-clipper-toolbar .cancel-btn {
        background: #f8f9fa !important;
        color: #495057 !important;
      }

      .outline-clipper-toolbar .clear-btn {
        background: #fff3cd !important;
        color: #856404 !important;
      }

      .outline-selection-info {
        position: fixed !important;
        top: 80px !important;
        right: 20px !important;
        background: white !important;
        padding: 12px 16px !important;
        border-radius: 8px !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15) !important;
        font-size: 14px !important;
        color: #495057 !important;
        z-index: 999998 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
    `;
    document.head.appendChild(style);
  }

  private addSelectionEventListeners() {
    // 클릭 이벤트
    this.overlay?.addEventListener('click', this.handleElementClick);

    // 드래그 이벤트
    this.overlay?.addEventListener('mousedown', this.handleDragStart);
    this.overlay?.addEventListener('mousemove', this.handleDragMove);
    this.overlay?.addEventListener('mouseup', this.handleDragEnd);

    // 호버 이벤트
    document.addEventListener('mouseover', this.handleHover);
    document.addEventListener('mouseout', this.handleMouseOut);

    // 키보드 이벤트
    document.addEventListener('keydown', this.handleKeyPress);
  }

  private handleElementClick = (e: MouseEvent) => {
    if (this.isDragging) return;

    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (target && target !== this.overlay && target !== this.toolbarButton) {
      this.toggleElementSelection(target as HTMLElement);
    }
  };

  private handleDragStart = (e: MouseEvent) => {
    this.isDragging = true;
    this.dragStart = { x: e.clientX, y: e.clientY };

    // 선택 박스 생성
    if (!this.selectionBox) {
      this.selectionBox = document.createElement('div');
      this.selectionBox.id = 'outline-clipper-selection-box';
      document.body.appendChild(this.selectionBox);
    }

    this.selectionBox.style.left = e.clientX + 'px';
    this.selectionBox.style.top = e.clientY + 'px';
    this.selectionBox.style.width = '0px';
    this.selectionBox.style.height = '0px';
  };

  private handleDragMove = (e: MouseEvent) => {
    if (!this.isDragging || !this.dragStart || !this.selectionBox) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(currentX, this.dragStart.x);
    const top = Math.min(currentY, this.dragStart.y);
    const width = Math.abs(currentX - this.dragStart.x);
    const height = Math.abs(currentY - this.dragStart.y);

    this.selectionBox.style.left = left + 'px';
    this.selectionBox.style.top = top + 'px';
    this.selectionBox.style.width = width + 'px';
    this.selectionBox.style.height = height + 'px';

    // 드래그 영역 내의 요소들 하이라이트
    this.highlightElementsInBox(left, top, width, height);
  };

  private handleDragEnd = (e: MouseEvent) => {
    if (!this.isDragging) return;

    this.isDragging = false;
    this.dragStart = null;

    // 선택 박스 제거
    if (this.selectionBox) {
      this.selectionBox.remove();
      this.selectionBox = null;
    }

    // 선택된 요소가 있으면 메시지 표시 후 자동 저장
    if (this.selectedElements.length > 0) {
      this.showSelectionMessage();
      // 1초 후 자동으로 저장하고 팝업 열기
      setTimeout(() => {
        this.saveSelectedElements();
      }, 1000);
    }
  };

  private highlightElementsInBox(left: number, top: number, width: number, height: number) {
    const right = left + width;
    const bottom = top + height;

    // 모든 요소 검사
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      const rect = el.getBoundingClientRect();

      // 요소가 선택 박스와 겹치는지 확인
      if (rect.left < right && rect.right > left &&
          rect.top < bottom && rect.bottom > top &&
          !this.isOverlayElement(el as HTMLElement)) {

        // 이미 선택되지 않은 요소만 추가
        if (!this.selectedElements.includes(el as HTMLElement)) {
          this.selectedElements.push(el as HTMLElement);
          (el as HTMLElement).classList.add('outline-clipper-selected');
        }
      }
    });

    this.updateSelectionInfo();
  }

  private handleHover = (e: MouseEvent) => {
    if (this.isDragging || !this.selectionMode) return;

    const target = e.target as HTMLElement;
    if (this.isOverlayElement(target)) return;

    if (this.hoveredElement && this.hoveredElement !== target) {
      this.hoveredElement.classList.remove('outline-clipper-hover');
    }

    if (!target.classList.contains('outline-clipper-selected')) {
      target.classList.add('outline-clipper-hover');
      this.hoveredElement = target;
    }
  };

  private handleMouseOut = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target === this.hoveredElement) {
      target.classList.remove('outline-clipper-hover');
      this.hoveredElement = null;
    }
  };

  private handleKeyPress = (e: KeyboardEvent) => {
    if (!this.selectionMode) return;

    if (e.key === 'Escape') {
      this.stopSelectionMode();
    } else if (e.key === 'Enter' && this.selectedElements.length > 0) {
      this.saveSelectedElements();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      this.selectAll();
    }
  };

  private toggleElementSelection(element: HTMLElement) {
    const index = this.selectedElements.indexOf(element);

    if (index > -1) {
      // 이미 선택된 경우 선택 해제
      this.selectedElements.splice(index, 1);
      element.classList.remove('outline-clipper-selected');
    } else {
      // 선택되지 앎은 경우 선택
      this.selectedElements.push(element);
      element.classList.add('outline-clipper-selected');
    }

    // 선택된 요소가 있으면 메시지 표시 후 자동 저장
    if (this.selectedElements.length > 0) {
      this.showSelectionMessage();
      // 1초 후 자동으로 저장하고 팝업 열기
      setTimeout(() => {
        this.saveSelectedElements();
      }, 1000);
    }
  }

  private selectAll() {
    const mainContent = document.querySelector('main, article, [role="main"], .content, #content') || document.body;
    const elements = mainContent.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, table, img, pre, blockquote');

    elements.forEach(el => {
      if (!this.isOverlayElement(el as HTMLElement) && !this.selectedElements.includes(el as HTMLElement)) {
        this.selectedElements.push(el as HTMLElement);
        (el as HTMLElement).classList.add('outline-clipper-selected');
      }
    });

    this.showSelectionMessage();
    // 1초 후 자동으로 저장하고 팝업 열기
    setTimeout(() => {
      this.saveSelectedElements();
    }, 1000);
  }

  private showSelectionMessage() {
    // 기존 메시지 제거
    const existingMsg = document.getElementById('outline-clipper-selection-message');
    if (existingMsg) existingMsg.remove();

    // 선택 완료 메시지 표시
    const message = document.createElement('div');
    message.id = 'outline-clipper-selection-message';
    message.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
      <span>${this.selectedElements.length}개 영역이 선택되었습니다</span>
    `;

    document.body.appendChild(message);

    // 메시지 페이드 아웃
    setTimeout(() => {
      message.style.animation = 'fadeOutScale 0.3s ease-out';
      setTimeout(() => message.remove(), 300);
    }, 700);
  }

  private showToolbar() {
    if (this.toolbar) return;

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'outline-clipper-toolbar';
    this.toolbar.innerHTML = `
      <button class="save-btn">
        <span>💾 Outline에 저장 (${this.selectedElements.length}개 항목)</span>
      </button>
      <button class="clear-btn">
        <span>🔄 선택 초기화</span>
      </button>
      <button class="cancel-btn">
        <span>❌ 취소</span>
      </button>
    `;

    document.body.appendChild(this.toolbar);

    // 버튼 이벤트 리스너
    this.toolbar.querySelector('.save-btn')?.addEventListener('click', () => this.saveSelectedElements());
    this.toolbar.querySelector('.clear-btn')?.addEventListener('click', () => this.clearSelection());
    this.toolbar.querySelector('.cancel-btn')?.addEventListener('click', () => this.stopSelectionMode());
  }

  private hideToolbar() {
    if (this.toolbar) {
      this.toolbar.remove();
      this.toolbar = null;
    }
  }

  private updateSelectionInfo() {
    let info = document.querySelector('.outline-selection-info') as HTMLDivElement;

    if (this.selectedElements.length > 0) {
      if (!info) {
        info = document.createElement('div');
        info.className = 'outline-selection-info';
        document.body.appendChild(info);
      }

      info.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
          <div>
            <div>✅ ${this.selectedElements.length}개 요소 선택됨</div>
            <div style="font-size: 12px; margin-top: 4px; opacity: 0.8;">
              Enter: 저장 | Ctrl+A: 전체 선택 | ESC: 취소
            </div>
          </div>
          <button id="outline-clipper-save-selection" style="
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
          ">
            💾 저장
          </button>
        </div>
      `;

      // 저장 버튼 이벤트 리스너 추가
      const saveButton = info.querySelector('#outline-clipper-save-selection');
      if (saveButton) {
        saveButton.addEventListener('click', () => this.saveSelectedElements());
        saveButton.addEventListener('mouseenter', (e) => {
          const btn = e.target as HTMLElement;
          btn.style.transform = 'scale(1.05)';
          btn.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
        });
        saveButton.addEventListener('mouseleave', (e) => {
          const btn = e.target as HTMLElement;
          btn.style.transform = 'scale(1)';
          btn.style.boxShadow = 'none';
        });
      }
    } else if (info) {
      info.remove();
    }
  }

  private clearSelection() {
    this.selectedElements.forEach(el => {
      el.classList.remove('outline-clipper-selected');
    });
    this.selectedElements = [];
    this.updateSelectionInfo();
    this.hideToolbar();
  }

  private async saveSelectedElements() {
    if (this.selectedElements.length === 0) return;

    // 선택된 요소들의 HTML 결합
    const combinedHTML = this.selectedElements
      .map(el => el.outerHTML)
      .join('\n');

    // 임시 컨테이너에 넣어서 추출
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = combinedHTML;

    const content = await this.extractor.extractElementContent(tempContainer);

    if (this.selectionModeData?.temporary) {
      // 팝업으로 전송
      chrome.runtime.sendMessage({
        action: 'elementSelected',
        content: content
      });
    } else {
      // 바로 저장
      chrome.runtime.sendMessage({
        action: 'clipSelectedContent',
        content: content,
        collectionId: this.selectionModeData.collectionId,
        parentDocumentId: this.selectionModeData.parentDocumentId,
        options: this.selectionModeData.options
      });
    }

    this.stopSelectionMode();

    // 팝업 열기
    chrome.runtime.sendMessage({ action: 'openPopup' });
  }

  private isOverlayElement(element: HTMLElement): boolean {
    return element === this.overlay ||
           element === this.toolbarButton ||
           element === this.toolbar ||
           element === this.selectionBox ||
           element.closest('#outline-clipper-overlay') !== null ||
           element.closest('#outline-clipper-toolbar-button') !== null ||
           element.closest('.outline-clipper-toolbar') !== null ||
           element.closest('.outline-selection-info') !== null;
  }

  private stopSelectionMode() {
    this.selectionMode = false;
    this.selectionModeData = null;

    // 선택 해제
    this.clearSelection();

    // UI 요소 제거
    this.overlay?.remove();
    this.overlay = null;

    this.toolbarButton?.remove();
    this.toolbarButton = null;

    this.toolbar?.remove();
    this.toolbar = null;

    this.selectionBox?.remove();
    this.selectionBox = null;

    // 정보 표시 제거
    document.querySelector('.outline-selection-info')?.remove();

    // 스타일 제거
    document.getElementById('outline-clipper-selection-style')?.remove();

    // 호버 효과 제거
    if (this.hoveredElement) {
      this.hoveredElement.classList.remove('outline-clipper-hover');
      this.hoveredElement = null;
    }

    // 이벤트 리스너 제거
    document.removeEventListener('mouseover', this.handleHover);
    document.removeEventListener('mouseout', this.handleMouseOut);
    document.removeEventListener('keydown', this.handleKeyPress);
  }
}

// 초기화
new ContentScript();