
// src/features/storage/config.ts
import { OutlineConfig, ClipperOptions } from '../../types';

export class ConfigStorage {
  static async getConfig(): Promise<OutlineConfig | null> {
    const result = await chrome.storage.sync.get(['outlineConfig']);
    return result.outlineConfig || null;
  }

  static async setConfig(config: OutlineConfig): Promise<void> {
    await chrome.storage.sync.set({ outlineConfig: config });
  }

  static async getClipperOptions(): Promise<ClipperOptions> {
    const result = await chrome.storage.sync.get(['clipperOptions']);
    return result.clipperOptions || {
      includeImages: true,
      uploadImages: true,
      simplifyContent: false,
      addSourceUrl: true,
      addTimestamp: true,
      addHighlights: true,
      removeAds: true,
      keepFormatting: false,
      tags: []
    };
  }

  static async setClipperOptions(options: ClipperOptions): Promise<void> {
    await chrome.storage.sync.set({ clipperOptions: options });
  }

  static async getRecentClips(): Promise<any[]> {
    const result = await chrome.storage.local.get(['recentClips']);
    return result.recentClips || [];
  }

  static async addRecentClip(clip: any): Promise<void> {
    const recentClips = await this.getRecentClips();
    recentClips.unshift({
      ...clip,
      timestamp: new Date().toISOString()
    });

    // 최근 10개만 유지
    const trimmedClips = recentClips.slice(0, 10);
    await chrome.storage.local.set({ recentClips: trimmedClips });
  }

  static async getLastSelectedCollections(): Promise<string[] | null> {
    const result = await chrome.storage.local.get(['lastSelectedCollections']);
    return result.lastSelectedCollections || null;
  }

  static async setLastSelectedCollections(collections: string[]): Promise<void> {
    await chrome.storage.local.set({ lastSelectedCollections: collections });
  }

  static async getLastSelectedLocation(): Promise<{collectionId: string, parentDocumentId?: string} | null> {
    const result = await chrome.storage.local.get(['lastSelectedLocation']);
    return result.lastSelectedLocation || null;
  }

  static async setLastSelectedLocation(location: {collectionId: string, parentDocumentId?: string}): Promise<void> {
    await chrome.storage.local.set({ lastSelectedLocation: location });
  }
}