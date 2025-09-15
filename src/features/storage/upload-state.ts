// src/features/storage/upload-state.ts

export interface UploadState {
  isUploading: boolean;
  currentIndex: number;
  totalImages: number;
  startTime: number;
  documentId?: string;
  shouldStop?: boolean;
}

export class UploadStateStorage {
  private static readonly STORAGE_KEY = 'outline_clipper_upload_state';

  static async getState(): Promise<UploadState | null> {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      return result[this.STORAGE_KEY] || null;
    } catch (error) {
      console.error('업로드 상태 읽기 오류:', error);
      return null;
    }
  }

  static async setState(state: UploadState): Promise<void> {
    try {
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: state
      });
    } catch (error) {
      console.error('업로드 상태 저장 오류:', error);
    }
  }

  static async clearState(): Promise<void> {
    try {
      await chrome.storage.local.remove(this.STORAGE_KEY);
    } catch (error) {
      console.error('업로드 상태 삭제 오류:', error);
    }
  }

  static async requestStop(): Promise<void> {
    const state = await this.getState();
    if (state && state.isUploading) {
      await this.setState({
        ...state,
        shouldStop: true
      });
    }
  }

  static async updateProgress(currentIndex: number, totalImages: number): Promise<void> {
    const state = await this.getState();
    if (state) {
      await this.setState({
        ...state,
        currentIndex,
        totalImages
      });
    }
  }
}