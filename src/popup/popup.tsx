
// src/popup/popup.tsx
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigStorage } from '../features/storage/config';
import { OutlineClient } from '../features/outline_integration/client';
import { OutlineConfig, ClipperOptions, Collection, ClipperMode } from '../types';
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'none' | 'testing' | 'success' | 'error'>('none');
  const [errorMessage, setErrorMessage] = useState('');
  const [clipperMode, setClipperMode] = useState<ClipperMode>({ type: 'full' });

  useEffect(() => {
    loadSettings();
  }, []);

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

    setIsClipping(true);
    setErrorMessage('');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        throw new Error('활성 탭을 찾을 수 없습니다');
      }

      const response = await chrome.runtime.sendMessage({
        action: 'clip',
        tabId: tab.id,
        collectionId: selectedLocation.collectionId,
        parentDocumentId: selectedLocation.parentDocumentId,
        options: options
      });

      if (response.success) {
        await ConfigStorage.setLastSelectedLocation(selectedLocation);
        window.close();
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


  return (
    <div className="popup">
      <div className="header">
        <h2>Outline 파워 웹 클리퍼</h2>
        <div className="header-actions">
          <button
            className="icon-btn"
            onClick={() => setShowAdvanced(!showAdvanced)}
            title="고급 옵션"
          >
            🎛️
          </button>
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
      ) : showAdvanced ? (
        <div className="advanced-options">
          <h3>고급 옵션</h3>

          <div className="clipper-modes">
            <label className={clipperMode.type === 'full' ? 'active' : ''}>
              <input
                type="radio"
                name="mode"
                checked={clipperMode.type === 'full'}
                onChange={() => setClipperMode({ type: 'full' })}
              />
              <span>📄 전체 페이지</span>
            </label>

            <label className={clipperMode.type === 'simplified' ? 'active' : ''}>
              <input
                type="radio"
                name="mode"
                checked={clipperMode.type === 'simplified'}
                onChange={() => setClipperMode({ type: 'simplified' })}
              />
              <span>📝 단순화</span>
            </label>

            <label className={clipperMode.type === 'selection' ? 'active' : ''}>
              <input
                type="radio"
                name="mode"
                checked={clipperMode.type === 'selection'}
                onChange={() => setClipperMode({ type: 'selection' })}
              />
              <span>✂️ 선택 영역</span>
            </label>
          </div>

          <div className="format-options">
            <label>
              <input
                type="checkbox"
                checked={options.simplifyContent}
                onChange={(e) => setOptions({ ...options, simplifyContent: e.target.checked })}
              />
              콘텐츠 단순화
            </label>

            <label>
              <input
                type="checkbox"
                checked={options.keepFormatting}
                onChange={(e) => setOptions({ ...options, keepFormatting: e.target.checked })}
              />
              원본 포맷 유지
            </label>
          </div>

          <button
            className="highlight-btn"
            onClick={highlightContent}
          >
            🔍 메인 콘텐츠 미리보기
          </button>

          <button
            className="back-btn"
            onClick={() => setShowAdvanced(false)}
          >
            돌아가기
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

              <div className="quick-options">
                <label className="quick-option">
                  <input
                    type="checkbox"
                    checked={options.uploadImages}
                    onChange={(e) => setOptions({ ...options, uploadImages: e.target.checked })}
                  />
                  <span>🖼️ 이미지 업로드</span>
                </label>

                <label className="quick-option">
                  <input
                    type="checkbox"
                    checked={options.simplifyContent}
                    onChange={(e) => setOptions({ ...options, simplifyContent: e.target.checked })}
                  />
                  <span>📝 단순화</span>
                </label>
              </div>

              <button
                className="clip-btn"
                onClick={handleClip}
                disabled={isClipping || !selectedLocation.collectionId}
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
