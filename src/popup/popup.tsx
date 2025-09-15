
// src/popup/popup.tsx
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigStorage } from '../features/storage/config';
import { OutlineClient } from '../features/outline_integration/client';
import { OutlineConfig, ClipperOptions, Collection, ClipperMode } from '../types';
import { UploadStateStorage, UploadState } from '../features/storage/upload-state';
import './popup.css';

const Popup: React.FC = () => {
  const [config, setConfig] = useState<OutlineConfig>({
    apiUrl: 'https://docs.jhome.xyz',
    apiToken: 'ol_api_iCGAnnxRJKeSD8eAMBRX9CP40mEZnPJIvOEeHZ',
    defaultCollectionId: ''
  });
  const [options, setOptions] = useState<ClipperOptions>({
    includeImages: true,
    uploadImages: true,
    simplifyContent: false,
    addSourceUrl: true,
    addTimestamp: true,
    addHighlights: true,
    removeAds: true,
    keepFormatting: false,
    tags: []
  });
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<{collectionId: string, parentDocumentId?: string}>({collectionId: ''});
  const [isClipping, setIsClipping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'none' | 'testing' | 'success' | 'error'>('none');
  const [errorMessage, setErrorMessage] = useState('');
  const [clipperMode, setClipperMode] = useState<ClipperMode>({ type: 'full' });
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);

  useEffect(() => {
    loadSettings();
    checkUploadState();

    // content script로부터 선택 메시지 수신
    const handleMessage = (message: any) => {
      if (message.action === 'elementSelected') {
        setSelectedElement(message.content);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    // 업로드 상태를 주기적으로 체크
    const interval = setInterval(() => {
      checkUploadState();
    }, 1000);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      clearInterval(interval);
    };
  }, []);

  const checkUploadState = async () => {
    const state = await UploadStateStorage.getState();
    setUploadState(state);

    // 업로드 중이면 클리핑 중 상태로 설정
    if (state && state.isUploading) {
      setIsClipping(true);
      const progress = Math.round((state.currentIndex / state.totalImages) * 100);
      setErrorMessage(`📤 이미지 업로드 중... ${state.currentIndex}/${state.totalImages} (${progress}%)`);
    } else if (!state || !state.isUploading) {
      // 업로드가 완료되거나 없으면 상태 초기화
      if (isClipping && uploadState?.isUploading) {
        setIsClipping(false);
        setErrorMessage('');
      }
    }
  };

  const handleStopUpload = async () => {
    await UploadStateStorage.requestStop();
    setErrorMessage('⏹️ 업로드 중지 요청...');
    // 잠시 후 상태 체크
    setTimeout(() => {
      checkUploadState();
    }, 500);
  };

  const loadSettings = async () => {
    const savedConfig = await ConfigStorage.getConfig();
    const savedOptions = await ConfigStorage.getClipperOptions();

    if (savedConfig) {
      setConfig(savedConfig);
      const lastSelected = await ConfigStorage.getLastSelectedLocation();
      setSelectedLocation(lastSelected || {collectionId: savedConfig.defaultCollectionId || ''});
      if (savedConfig.apiUrl && savedConfig.apiToken) {
        loadCollections(savedConfig);
      } else {
        setShowSettings(true);
      }
    } else {
      setShowSettings(true);
    }

    setOptions(savedOptions);
  };

  const loadCollections = async (configToUse: OutlineConfig) => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getCollections',
        config: configToUse
      });

      if (response.success) {
        console.log('Popup에서 받은 컬렉션:', response.collections);
        setCollections(response.collections);
        if (response.collections.length > 0 && !selectedLocation.collectionId) {
          setSelectedLocation({collectionId: response.collections[0].id});
        }
      } else {
        console.error('컬렉션 로드 실패:', response.error);
        setErrorMessage(`컬렉션 로드 실패: ${response.error}`);
      }
    } catch (error) {
      console.error('컬렉션 로드 실패:', error);
      setErrorMessage('컬렉션 로드 중 오류가 발생했습니다');
    }
  };

  const testConnection = async () => {
    if (!config.apiUrl || !config.apiToken) {
      setErrorMessage('API URL과 토큰을 모두 입력해주세요');
      return;
    }

    setConnectionStatus('testing');
    setErrorMessage('');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        config
      });

      if (response.success) {
        setConnectionStatus('success');
        await saveConfig();
        await loadCollections(config);
        setTimeout(() => {
          setShowSettings(false);
          setConnectionStatus('none');
        }, 1500);
      } else {
        setConnectionStatus('error');
        setErrorMessage('연결 실패: API URL 또는 토큰을 확인해주세요');
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage('연결 테스트 중 오류가 발생했습니다');
    }
  };

  const saveConfig = async () => {
    const configToSave = {
      ...config,
      defaultCollectionId: selectedLocation.collectionId
    };
    await ConfigStorage.setConfig(configToSave);
    await ConfigStorage.setClipperOptions(options);
    await ConfigStorage.setLastSelectedLocation(selectedLocation);
  };

  const handleClip = async () => {
    if (!selectedLocation.collectionId) {
      setErrorMessage('컬렉션을 선택해주세요');
      return;
    }

    if (clipperMode.type === 'selection' && !selectedElement) {
      setErrorMessage('먼저 웹페이지에서 영역을 선택해주세요');
      return;
    }

    setIsClipping(true);
    setErrorMessage('');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        throw new Error('활성 탭을 찾을 수 없습니다');
      }

      let response;
      
      if (clipperMode.type === 'selection' && selectedElement) {
        // 선택 모드일 때는 이미 선택된 콘텐츠를 사용
        response = await chrome.runtime.sendMessage({
          action: 'clipSelectedContent',
          content: selectedElement,
          collectionId: selectedLocation.collectionId,
          parentDocumentId: selectedLocation.parentDocumentId,
          options: options
        });
      } else {
        // 일반 모드
        response = await chrome.runtime.sendMessage({
          action: 'clip',
          tabId: tab.id,
          collectionId: selectedLocation.collectionId,
          parentDocumentId: selectedLocation.parentDocumentId,
          options: { ...options, mode: clipperMode.type }
        });
      }

      if (response.success) {
        await ConfigStorage.setLastSelectedLocation(selectedLocation);
        // 이미지 업로드가 포함된 경우 잠시 대기 (진행 상황 표시)
        if (options.uploadImages && response.imageCount > 0) {
          setErrorMessage(`✅ 문서 저장 완료. ${response.imageCount}개 이미지 처리 중...`);
          // 이미지 개수에 따라 대기 시간 조정
          const waitTime = Math.min(3000 + (response.imageCount * 500), 10000);
          setTimeout(() => {
            window.close();
          }, waitTime);
        } else {
          window.close();
        }
      } else {
        setErrorMessage(response.error || '저장 실패');
      }
    } catch (error: any) {
      setErrorMessage(error.message || '클리핑 중 오류가 발생했습니다');
    } finally {
      setIsClipping(false);
    }
  };

  const highlightContent = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.tabs.sendMessage(tab.id, { action: 'highlightContent' });
    }
  };

  const handleModeChange = async (mode: ClipperMode) => {
    setClipperMode(mode);
    
    if (mode.type === 'selection') {
      // 선택 영역 모드일 때 웹페이지에서 선택하도록 안내
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        // content script에 선택 모드 시작 메시지 전송 (팝업은 열린 상태 유지)
        await chrome.tabs.sendMessage(tab.id, { 
          action: 'startSelectionMode',
          temporary: true // 임시 선택 모드
        });
      }
    }
  };


  return (
    <div className="popup">
      <div className="header">
        <h2>Outline 파워 웹 클리퍼</h2>
        <div className="header-actions">
          <button
            className="icon-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="설정"
          >
            ⚙️
          </button>
        </div>
      </div>

      {showSettings ? (
        <div className="settings">
          <h3>Outline 설정</h3>

          <div className="form-group">
            <label htmlFor="apiUrl">API URL</label>
            <input
              id="apiUrl"
              type="url"
              placeholder="https://your-outline-instance.com"
              value={config.apiUrl}
              onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label htmlFor="apiToken">API 토큰</label>
            <input
              id="apiToken"
              type="password"
              placeholder="API 토큰을 입력하세요"
              value={config.apiToken}
              onChange={(e) => setConfig({ ...config, apiToken: e.target.value })}
            />
            <small>설정 → API 토큰에서 생성할 수 있습니다</small>
          </div>

          <button
            className={`test-btn ${connectionStatus}`}
            onClick={testConnection}
            disabled={connectionStatus === 'testing'}
          >
            {connectionStatus === 'testing' && '연결 테스트 중...'}
            {connectionStatus === 'success' && '✓ 연결 성공!'}
            {connectionStatus === 'error' && '✗ 연결 실패'}
            {connectionStatus === 'none' && '연결 테스트'}
          </button>

          <h3>기본 클리핑 옵션</h3>

          <div className="options">
            <label>
              <input
                type="checkbox"
                checked={options.includeImages}
                onChange={(e) => setOptions({ ...options, includeImages: e.target.checked })}
              />
              이미지 포함
            </label>

            <label>
              <input
                type="checkbox"
                checked={options.uploadImages}
                onChange={(e) => setOptions({ ...options, uploadImages: e.target.checked })}
                disabled={!options.includeImages}
              />
              이미지를 Outline에 업로드
            </label>

            <label>
              <input
                type="checkbox"
                checked={options.removeAds}
                onChange={(e) => setOptions({ ...options, removeAds: e.target.checked })}
              />
              광고 제거
            </label>

            <label>
              <input
                type="checkbox"
                checked={options.addSourceUrl}
                onChange={(e) => setOptions({ ...options, addSourceUrl: e.target.checked })}
              />
              원본 URL 추가
            </label>

            <label>
              <input
                type="checkbox"
                checked={options.addTimestamp}
                onChange={(e) => setOptions({ ...options, addTimestamp: e.target.checked })}
              />
              클리핑 시간 추가
            </label>

            <label>
              <input
                type="checkbox"
                checked={options.addHighlights}
                onChange={(e) => setOptions({ ...options, addHighlights: e.target.checked })}
              />
              하이라이트 추출
            </label>
          </div>

          <button
            className="save-btn"
            onClick={async () => {
              await saveConfig();
              setShowSettings(false);
            }}
          >
            저장
          </button>
        </div>
      ) : (
        <div className="clipper">
          {collections.length > 0 ? (
            <>
              <div className="form-group">
                <label htmlFor="collection">컬렉션 선택</label>
                <select
                  id="collection"
                  value={selectedLocation.collectionId}
                  onChange={(e) => setSelectedLocation({collectionId: e.target.value})}
                >
                  <option value="">컬렉션을 선택하세요</option>
                  {collections.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.icon} {col.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="clipper-modes">
                <button 
                  className={`mode-btn ${clipperMode.type === 'full' ? 'active' : ''}`}
                  onClick={() => handleModeChange({ type: 'full' })}
                  title="전체 페이지를 저장합니다"
                >
                  📄 전체
                </button>
                <button 
                  className={`mode-btn ${clipperMode.type === 'simplified' ? 'active' : ''}`}
                  onClick={() => handleModeChange({ type: 'simplified' })}
                  title="광고와 불필요한 요소를 제거하고 저장합니다"
                >
                  📝 단순화
                </button>
                <button 
                  className={`mode-btn selection-mode ${clipperMode.type === 'selection' ? 'active' : ''}`}
                  onClick={() => handleModeChange({ type: 'selection' })}
                  title="특정 영역을 선택하여 저장합니다"
                >
                  ✂️ 선택
                </button>
              </div>

              {clipperMode.type === 'selection' && selectedElement && (
                <div className="selection-status">
                  ✅ 영역이 선택되었습니다
                </div>
              )}

              {clipperMode.type === 'selection' && !selectedElement && (
                <div className="selection-instruction">
                  👆 웹페이지에서 저장할 영역을 클릭하세요
                </div>
              )}

              <div className="quick-options">
                <label className="quick-option">
                  <input
                    type="checkbox"
                    checked={options.uploadImages}
                    onChange={(e) => setOptions({ ...options, uploadImages: e.target.checked })}
                  />
                  <span>🖼️ 이미지 업로드</span>
                </label>
              </div>

              <button
                className="clip-btn"
                onClick={handleClip}
                disabled={isClipping || !selectedLocation.collectionId || (clipperMode.type === 'selection' && !selectedElement)}
              >
                {isClipping ? (
                  <>
                    <span className="spinner"></span>
                    저장 중...
                  </>
                ) : (
                  '📎 Outline에 저장'
                )}
              </button>

              {/* 업로드 진행 중일 때 중지 버튼 표시 */}
              {uploadState && uploadState.isUploading && (
                <button
                  className="stop-btn"
                  onClick={handleStopUpload}
                  title="업로드 중지"
                >
                  ⏹️ 업로드 중지
                </button>
              )}

            </>
          ) : (
            <div className="no-config">
              <p>설정이 필요합니다</p>
              <button onClick={() => setShowSettings(true)}>
                설정하기
              </button>
            </div>
          )}
        </div>
      )}

      {errorMessage && (
        <div className="error-message">
          {errorMessage}
        </div>
      )}
    </div>
  );
};

// React 앱 마운트
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<Popup />);
