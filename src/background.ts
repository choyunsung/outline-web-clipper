
// src/background.ts
import { OutlineClient } from './features/outline_integration/client';
import { ConfigStorage } from './features/storage/config';
import { PageContent, ClipperOptions } from './types';

// 컨텍스트 메뉴 생성
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'clipToOutline',
    title: 'Outline에 저장',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'clipSelectionToOutline',
    title: '선택 영역을 Outline에 저장',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'clipScreenshotToOutline',
    title: '스크린샷을 Outline에 저장',
    contexts: ['page']
  });
});

// 컨텍스트 메뉴 클릭 처리
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  switch (info.menuItemId) {
    case 'clipToOutline':
      await clipCurrentPage(tab.id);
      break;
    case 'clipSelectionToOutline':
      await clipSelection(tab.id);
      break;
    case 'clipScreenshotToOutline':
      await clipScreenshot(tab.id);
      break;
  }
});

// 메시지 처리
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true;
});

async function handleMessage(request: any, sender: any, sendResponse: Function) {
  try {
    switch (request.action) {
      case 'clip':
        const result = await clipWithOptions(request.tabId, request.options, request.collectionId, request.parentDocumentId);
        sendResponse(result);
        break;

      case 'clipSelection':
        if (sender.tab?.id) {
          const selectionResult = await processClip(request.content, sender.tab.id);
          sendResponse(selectionResult);
        }
        break;

      case 'testConnection':
        const testResult = await testOutlineConnection(request.config);
        sendResponse(testResult);
        break;

      case 'getCollections':
        const collectionsResult = await getCollections(request.config);
        sendResponse(collectionsResult);
        break;

      case 'getCollectionDocuments':
        const documentsResult = await getCollectionDocuments(request.config, request.collectionId);
        sendResponse(documentsResult);
        break;

      case 'captureScreenshot':
        if (sender.tab?.id) {
          const screenshotResult = await captureTabScreenshot(sender.tab.id);
          sendResponse(screenshotResult);
        }
        break;

      case 'searchDuplicates':
        const searchResult = await searchDuplicates(request.url);
        sendResponse(searchResult);
        break;

      default:
        sendResponse({ success: false, error: '알 수 없는 액션' });
    }
  } catch (error: any) {
    sendResponse({ success: false, error: error.message });
  }
}

async function testOutlineConnection(config: any) {
  const client = new OutlineClient(config);
  const isConnected = await client.testConnection();
  return { success: isConnected };
}

async function getCollections(config: any) {
  try {
    const client = new OutlineClient(config);
    const collections = await client.getCollections(false); // 문서는 나중에 로드
    return { success: true, collections };
  } catch (error: any) {
    console.error('컬렉션 로드 오류:', error);
    return { success: false, error: error.message };
  }
}

async function getCollectionDocuments(config: any, collectionId: string) {
  try {
    const client = new OutlineClient(config);
    const documents = await client.getCollectionDocuments(collectionId);
    return { success: true, documents };
  } catch (error: any) {
    console.error('문서 로드 오류:', error);
    return { success: false, error: error.message };
  }
}

async function searchDuplicates(url: string) {
  const config = await ConfigStorage.getConfig();
  if (!config) {
    return { success: false, error: '설정이 필요합니다' };
  }

  const client = new OutlineClient(config);
  const results = await client.searchDocuments(url);
  return { success: true, documents: results.data || [] };
}

async function clipWithOptions(
  tabId: number,
  options: ClipperOptions,
  collectionId?: string,
  parentDocumentId?: string
): Promise<any> {
  try {
    // 콘텐츠 추출
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'extractContent',
      options
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    return await processClip(response.content, tabId, collectionId, parentDocumentId);
  } catch (error: any) {
    console.error('클리핑 오류:', error);
    throw error;
  }
}

async function processClip(
  content: PageContent,
  tabId: number,
  collectionId?: string,
  parentDocumentId?: string
): Promise<any> {
  try {
    // 설정 가져오기
    const config = await ConfigStorage.getConfig();
    if (!config) {
      throw new Error('Outline 설정이 필요합니다');
    }

    const options = await ConfigStorage.getClipperOptions();
    const client = new OutlineClient(config);

    // 이미지 업로드 및 URL 교체
    let processedContent = content.content;
    if (options.uploadImages && content.images.length > 0) {
      try {
        showProgress('이미지 업로드 중...', 0);
        console.log(`${content.images.length}개의 이미지 업로드 시작`);
        processedContent = await client.processImagesInContent(
          processedContent,
          content.images
        );
        console.log('이미지 처리 완료');
      } catch (error: any) {
        console.warn('이미지 업로드 중 오류 발생, 원본 콘텐츠 사용:', error.message);
        // 이미지 업로드 실패해도 원본 콘텐츠로 계속 진행
      }
    }

    // 콘텐츠 포맷팅
    const formattedContent = formatContent(content, processedContent, options);

    // Outline에 문서 생성
    const targetCollectionId = collectionId || config.defaultCollectionId;
    if (!targetCollectionId) {
      throw new Error('컬렉션을 선택해주세요');
    }

    // 제목을 100자로 제한 (Outline API 요구사항)
    const truncatedTitle = truncateTitle(content.title);
    
    const result = await client.createDocument(
      truncatedTitle,
      formattedContent,
      targetCollectionId,
      {
        parentDocumentId
      }
    );

    // 최근 클립 저장
    await ConfigStorage.addRecentClip({
      title: content.title,
      url: content.url,
      documentId: result.data.id,
      collectionId: targetCollectionId
    });

    // 성공 알림
    showNotification('저장 완료', `"${content.title}"이(가) Outline에 저장되었습니다.`);

    return { success: true, documentId: result.data.id };
  } catch (error: any) {
    showNotification('저장 실패', error.message);
    throw error;
  }
}

async function clipCurrentPage(tabId: number) {
  const options = await ConfigStorage.getClipperOptions();
  const config = await ConfigStorage.getConfig();

  return clipWithOptions(tabId, options, config?.defaultCollectionId);
}

async function clipSelection(tabId: number) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'extractSelection'
    });

    if (!response.success || !response.content) {
      throw new Error('선택 영역이 없습니다');
    }

    return await processClip(response.content, tabId);
  } catch (error: any) {
    showNotification('저장 실패', error.message);
    throw error;
  }
}

async function clipScreenshot(tabId: number) {
  try {
    const dataUrl = await captureTabScreenshot(tabId);

    // 스크린샷을 Markdown 이미지로 변환
    const screenshotTitle = `스크린샷 - ${new Date().toLocaleString('ko-KR')}`;
    const content: PageContent = {
      title: truncateTitle(screenshotTitle),
      content: `![스크린샷](${dataUrl})`,
      url: (await chrome.tabs.get(tabId)).url || '',
      images: [{
        originalUrl: dataUrl
      }]
    };

    return await processClip(content, tabId);
  } catch (error: any) {
    showNotification('스크린샷 저장 실패', error.message);
    throw error;
  }
}

async function captureTabScreenshot(tabId: number): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab();
  return dataUrl;
}

function formatContent(
  content: PageContent,
  processedContent: string,
  options: ClipperOptions
): string {
  const metadata: string[] = [];

  if (content.author) {
    metadata.push(`> 👤 **저자**: ${content.author}`);
  }

  if (content.publishedDate) {
    const date = new Date(content.publishedDate).toLocaleDateString('ko-KR');
    metadata.push(`> 📅 **발행일**: ${date}`);
  }

  if (options.addSourceUrl) {
    metadata.push(`> 🔗 **원본**: [${content.url}](${content.url})`);
  }

  if (options.addTimestamp) {
    const now = new Date().toLocaleString('ko-KR');
    metadata.push(`> 📎 **클리핑**: ${now}`);
  }

  if (content.excerpt) {
    metadata.push(`\n**요약**: ${content.excerpt}`);
  }

  let formattedContent = processedContent;

  if (metadata.length > 0) {
    formattedContent = `${metadata.join('\n')}\n\n---\n\n${processedContent}`;
  }

  // 하이라이트 추가
  if (options.addHighlights && content.highlights && content.highlights.length > 0) {
    formattedContent += '\n\n## 📌 하이라이트\n\n';
    content.highlights.forEach(highlight => {
      formattedContent += `> ${highlight}\n\n`;
    });
  }

  return formattedContent;
}

function showNotification(title: string, message: string, type: 'basic' | 'progress' = 'basic') {
  chrome.notifications.create({
    type,
    iconUrl: 'icon128.png',
    title,
    message
  });
}

function showProgress(message: string, progress: number) {
  chrome.notifications.create('progress', {
    type: 'progress',
    iconUrl: 'icon128.png',
    title: 'Outline 웹 클리퍼',
    message,
    progress
  });
}

function truncateTitle(title: string): string {
  if (!title) {
    return '제목 없음';
  }
  
  // 100자 제한
  if (title.length <= 100) {
    return title;
  }
  
  // 100자로 자르고 끝에 ... 추가 (총 100자)
  return title.substring(0, 97) + '...';
}
