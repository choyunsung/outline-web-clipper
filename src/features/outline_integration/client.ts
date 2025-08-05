// src/features/outline_integration/client.ts
import {OutlineConfig, Collection, ImageInfo} from '../../types';

export class OutlineClient {
    private apiUrl: string;
    private apiToken: string;

    constructor(config: OutlineConfig) {
        this.apiUrl = config.apiUrl.replace(/\/$/, '');
        this.apiToken = config.apiToken;
    }

    async testConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiUrl}/api/auth.info`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json',
                },
            });

            return response.ok;
        } catch (error) {
            return false;
        }
    }

    async uploadImage(imageUrl: string, retryCount: number = 0): Promise<string> {
        const maxRetries = 3;
        const retryDelay = 1000 * Math.pow(2, retryCount);

        try {
            console.log('이미지 업로드 시작:', imageUrl, retryCount > 0 ? `(재시도 ${retryCount}/${maxRetries})` : '');

            const absoluteUrl = imageUrl.startsWith('http') ? imageUrl : imageUrl;

            const imageResponse = await fetch(absoluteUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Outline-Clipper/1.0)'
                }
            });

            if (!imageResponse.ok) throw new Error(`이미지 다운로드 실패: ${imageResponse.status} ${imageResponse.statusText}`);
            const blob = await imageResponse.blob();

            if (blob.size > 10 * 1024 * 1024) throw new Error(`이미지 파일이 너무 큽니다: ${Math.round(blob.size / 1024 / 1024)}MB`);
            if (!blob.type.startsWith('image/')) throw new Error(`이미지가 아닌 파일: ${blob.type}`);

            const fileName = this.generateFileName(absoluteUrl, blob.type);
            console.log('생성된 파일명:', fileName);

            // 1단계: attachments.create → 업로드 URL 및 필드 수신
            const metaRes = await fetch(`${this.apiUrl}/api/attachments.create`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: fileName,
                    contentType: blob.type,
                    size: blob.size,
                    preset: 'documentAttachment'
                })
            });

            if (!metaRes.ok) {
                const text = await metaRes.text();
                throw new Error(`attachments.create 실패: ${metaRes.status} ${metaRes.statusText} ${text}`);
            }

            const {data} = await metaRes.json();

            // 2단계: files.create → presigned 업로드 요청 전송
            const uploadForm = new FormData();
            for (const [key, value] of Object.entries(data.form)) {
                uploadForm.append(key, value as string);
            }
            uploadForm.append('file', blob, fileName);

            const uploadRes = await fetch(`${this.apiUrl}${data.uploadUrl}`, {
                method: 'POST',
                body: uploadForm
                // Content-Type 자동 설정됨
            });

            if (!uploadRes.ok) {
                const text = await uploadRes.text();
                throw new Error(`files.create 실패: ${uploadRes.status} ${uploadRes.statusText} ${text}`);
            }

            // 업로드된 파일 URL 반환
            const fileUrl = `${this.apiUrl}${data.attachment.url}`;
            console.log('업로드 성공:', fileUrl);
            return fileUrl;

        } catch (error: any) {
            if (error.message.includes('429') && retryCount < maxRetries) {
                console.log(`Rate limit 오류, ${retryDelay}ms 후 재시도...`);
                await this.delay(retryDelay);
                return this.uploadImage(imageUrl, retryCount + 1);
            }

            console.error('이미지 업로드 오류:', error.message);
            return imageUrl; // 실패 시 원본 URL 반환
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private generateFileName(url: string, mimeType: string): string {
        const extension = mimeType.split('/')[1] || 'png';
        const timestamp = Date.now();

        try {
            const urlObject = new URL(url);
            const pathParts = urlObject.pathname.split('/');
            const lastSegment = decodeURIComponent(pathParts[pathParts.length - 1]);
            const cleanName = lastSegment.split('?')[0];

            if (cleanName && cleanName.includes('.') && cleanName.length < 100) {
                return cleanName;
            }
        } catch {
            // URL 파싱 실패 시 fallback 사용
        }

        return `image_${timestamp}.${extension}`;
    }


    async createDocument(
        title: string,
        content: string,
        collectionId: string,
        options?: {
            publish?: boolean;
            parentDocumentId?: string;
        }
    ): Promise<any> {
        const response = await fetch(`${this.apiUrl}/api/documents.create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title,
                text: content,
                collectionId,
                publish: options?.publish ?? true,
                parentDocumentId: options?.parentDocumentId,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Outline API 오류: ${error}`);
        }

        return response.json();
    }

    async updateDocument(
        documentId: string,
        updates: {
            title?: string;
            text?: string;
            publish?: boolean;
        }
    ): Promise<any> {
        const response = await fetch(`${this.apiUrl}/api/documents.update`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: documentId,
                ...updates
            }),
        });

        if (!response.ok) {
            throw new Error('문서 업데이트 실패');
        }

        return response.json();
    }

    async getCollections(includeDocuments: boolean = false): Promise<Collection[]> {
        const response = await fetch(`${this.apiUrl}/api/collections.list`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                limit: 100,
            }),
        });

        if (!response.ok) {
            throw new Error('컬렉션 목록을 가져올 수 없습니다');
        }

        const data = await response.json();
        const collections = data.data || [];

        console.log('Outline API 응답:', data);
        console.log('컬렉션 데이터:', collections);

        // 컬렉션에 아이콘 설정
        collections.forEach((collection: any) => {
            console.log('컬렉션 처리 중:', collection);

            // Outline의 아이콘 필드는 문자열 타입 (예: "collection", "folder" 등)
            // 이를 실제 이모지로 변환하거나 색상 기반으로 설정
            collection.icon = this.getCollectionEmoji(collection);
            console.log(`최종 아이콘 설정: ${collection.icon}`);
        });

        // 문서 구조는 필요할 때만 가져오기
        if (includeDocuments) {
            for (const collection of collections) {
                try {
                    collection.documents = await this.getCollectionDocuments(collection.id);
                } catch (error) {
                    console.error(`컬렉션 ${collection.name}의 문서를 가져오는 중 오류:`, error);
                    collection.documents = [];
                }
            }
        }

        return collections;
    }

    async getCollectionDocuments(collectionId: string): Promise<any[]> {
        const response = await fetch(`${this.apiUrl}/api/documents.list`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                collectionId,
                limit: 100,
            }),
        });

        if (!response.ok) {
            throw new Error('문서 목록을 가져올 수 없습니다');
        }

        const data = await response.json();
        const documents = data.data || [];

        // 계층 구조 구성
        return this.buildDocumentTree(documents);
    }

    private buildDocumentTree(documents: any[]): any[] {
        const documentMap = new Map();
        const rootDocuments: any[] = [];

        // 모든 문서를 맵에 저장
        documents.forEach(doc => {
            doc.children = [];
            documentMap.set(doc.id, doc);
        });

        // 계층 구조 구성
        documents.forEach(doc => {
            if (doc.parentDocumentId && documentMap.has(doc.parentDocumentId)) {
                const parent = documentMap.get(doc.parentDocumentId);
                parent.children.push(doc);
            } else {
                rootDocuments.push(doc);
            }
        });

        return rootDocuments;
    }

    async searchDocuments(query: string): Promise<any> {
        const response = await fetch(`${this.apiUrl}/api/documents.search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query,
                limit: 10,
                includeArchived: false
            }),
        });

        return response.json();
    }

    async processImagesInContent(content: string, images: ImageInfo[]): Promise<string> {
        let processedContent = content;
        let successCount = 0;
        let failCount = 0;

        // 실제로 콘텐츠에 포함된 이미지만 필터링
        const contentImages = images.filter(image => {
            const isInContent = content.includes(image.originalUrl) || 
                               this.isImageInContent(content, image.originalUrl);
            if (!isInContent) {
                console.log(`콘텐츠에 포함되지 않은 이미지 건너뜀: ${image.originalUrl}`);
            }
            return isInContent;
        });

        // 이미지 수 제한 (너무 많으면 rate limit 발생 가능)
        const maxImages = 10;
        const imagesToProcess = contentImages.slice(0, maxImages);

        console.log(`전체 이미지: ${images.length}개, 콘텐츠 포함 이미지: ${contentImages.length}개`);
        if (contentImages.length > maxImages) {
            console.log(`콘텐츠 이미지가 ${contentImages.length}개 발견되었지만, rate limiting 방지를 위해 처음 ${maxImages}개만 업로드합니다.`);
        }

        console.log(`이미지 처리 시작: ${imagesToProcess.length}개`);

        for (let i = 0; i < imagesToProcess.length; i++) {
            const image = imagesToProcess[i];
            if (image.originalUrl) {
                try {
                    console.log(`이미지 ${i + 1}/${imagesToProcess.length} 처리 중: ${image.originalUrl}`);

                    // Rate limiting 방지를 위한 지연 (첫 번째 이미지 제외)
                    if (i > 0) {
                        const delay = 500; // 500ms 지연
                        console.log(`Rate limiting 방지를 위해 ${delay}ms 대기...`);
                        await this.delay(delay);
                    }

                    const outlineUrl = await this.uploadImage(image.originalUrl);

                    // 업로드 성공인지 확인 (원본 URL과 다른 경우)
                    if (outlineUrl !== image.originalUrl) {
                        image.outlineUrl = outlineUrl;
                        successCount++;

                        // 콘텐츠에서 이미지 URL 교체
                        const beforeReplace = processedContent;
                        processedContent = this.replaceImageUrlInContent(processedContent, image.originalUrl, outlineUrl);
                        
                        const replacementMade = beforeReplace !== processedContent;
                        console.log(`이미지 업로드 성공: ${image.originalUrl} → ${outlineUrl}`);
                        console.log(`콘텐츠에서 URL 교체 ${replacementMade ? '성공' : '실패'}`);
                        
                        if (!replacementMade) {
                            console.warn('콘텐츠에서 이미지 URL을 찾을 수 없습니다:', image.originalUrl);
                            console.log('콘텐츠 미리보기:', processedContent.substring(0, 500));
                        }
                    } else {
                        failCount++;
                        console.warn(`이미지 업로드 실패, 원본 URL 유지: ${image.originalUrl}`);
                    }
                } catch (error: any) {
                    failCount++;
                    console.error(`이미지 업로드 오류: ${image.originalUrl}`, error.message);
                }
            }
        }

        console.log(`이미지 처리 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
        if (images.length > maxImages) {
            console.log(`참고: ${images.length - maxImages}개의 이미지가 처리되지 않았습니다.`);
        }
        return processedContent;
    }

    private escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private replaceImageUrlInContent(content: string, originalUrl: string, newUrl: string): string {
        let updatedContent = content;
        
        // 1. 정확한 URL 매칭
        const exactPattern = new RegExp(this.escapeRegExp(originalUrl), 'g');
        updatedContent = updatedContent.replace(exactPattern, newUrl);
        
        // 2. 마크다운 이미지 태그에서 교체: ![alt](url)
        const markdownImagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${this.escapeRegExp(originalUrl)}\\)`, 'g');
        updatedContent = updatedContent.replace(markdownImagePattern, `![$1](${newUrl})`);
        
        // 3. HTML img 태그의 src 속성에서 교체
        const htmlImgPattern = new RegExp(`(<img[^>]*src=["'])${this.escapeRegExp(originalUrl)}(["'][^>]*>)`, 'g');
        updatedContent = updatedContent.replace(htmlImgPattern, `$1${newUrl}$2`);
        
        // 4. URL의 도메인과 경로가 다를 수 있는 경우를 위한 유연한 매칭
        try {
            const originalUrlObj = new URL(originalUrl);
            const originalPath = originalUrlObj.pathname;
            
            // 경로만으로 매칭하는 패턴 (절대 경로가 상대 경로로 변환된 경우)
            if (originalPath && originalPath.length > 10) { // 의미있는 경로만
                const pathPattern = new RegExp(this.escapeRegExp(originalPath), 'g');
                const beforePathReplace = updatedContent;
                updatedContent = updatedContent.replace(pathPattern, newUrl);
                
                if (beforePathReplace !== updatedContent) {
                    console.log(`경로 기반 URL 교체 성공: ${originalPath} → ${newUrl}`);
                }
            }
        } catch (error) {
            // URL 파싱 실패는 무시
        }
        
        return updatedContent;
    }

    private isImageInContent(content: string, imageUrl: string): boolean {
        try {
            const urlObj = new URL(imageUrl);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();
            
            // 1. 전체 URL 확인
            if (content.includes(imageUrl)) return true;
            
            // 2. 경로만 확인 (도메인이 다를 수 있음)
            if (pathname && content.includes(pathname)) return true;
            
            // 3. 파일명만 확인 (경로가 다를 수 있음)
            if (filename && filename.length > 5 && content.includes(filename)) return true;
            
            // 4. 마크다운 이미지 태그에서 확인
            const markdownPattern = new RegExp(`!\\[[^\\]]*\\]\\([^)]*${this.escapeRegExp(pathname || filename || '')}[^)]*\\)`);
            if (markdownPattern.test(content)) return true;
            
            return false;
        } catch (error) {
            // URL 파싱 실패 시 단순 문자열 포함 확인
            return content.includes(imageUrl);
        }
    }

    private getCollectionEmoji(collection: any): string {
        console.log('아이콘 생성 중, 컬렉션:', collection);

        // 1. 색상 기반 이모지 (우선순위 1)
        if (collection.color) {
            const colorEmoji = this.getEmojiFromColor(collection.color);
            if (colorEmoji) {
                console.log(`색상 ${collection.color}에서 이모지: ${colorEmoji}`);
                return colorEmoji;
            }
        }

        // 2. Outline 아이콘 타입 기반 이모지 (우선순위 2)
        if (collection.icon) {
            const iconEmoji = this.getEmojiFromIconType(collection.icon);
            if (iconEmoji) {
                console.log(`아이콘 타입 ${collection.icon}에서 이모지: ${iconEmoji}`);
                return iconEmoji;
            }
        }

        // 3. 이름 기반 이모지 (우선순위 3)
        const nameEmoji = this.getEmojiFromName(collection.name);
        if (nameEmoji) {
            console.log(`이름 ${collection.name}에서 이모지: ${nameEmoji}`);
            return nameEmoji;
        }

        // 4. 기본 이모지
        const defaultEmoji = this.getDefaultEmoji(collection.name || collection.id);
        console.log(`기본 이모지: ${defaultEmoji}`);
        return defaultEmoji;
    }

    private getEmojiFromColor(color: string): string | null {
        // HEX 색상 코드를 이모지로 변환
        const colorMap: { [key: string]: string } = {
            // 초록색 계열
            '#00D084': '🟢', '#4CAF50': '🟢', '#8BC34A': '🟢', '#CDDC39': '🟢',
            // 파란색 계열
            '#2196F3': '🔵', '#03A9F4': '🔵', '#00BCD4': '🔵', '#009688': '🔵',
            // 빨간색 계열
            '#F44336': '🔴', '#E91E63': '🔴',
            // 주황색 계열
            '#FF9800': '🟠', '#FF5722': '🟠',
            // 노란색 계열
            '#FFEB3B': '🟡', '#FFC107': '🟡',
            // 보라색 계열
            '#9C27B0': '🟣', '#673AB7': '🟣', '#3F51B5': '🟣',
            // 회색 계열
            '#9E9E9E': '⚫', '#607D8B': '⚫'
        };

        // 정확한 매칭 먼저 시도
        if (colorMap[color.toUpperCase()]) {
            return colorMap[color.toUpperCase()];
        }

        // HEX 색상을 RGB로 변환하여 유사한 색상 찾기
        if (color.startsWith('#') && color.length === 7) {
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);

            // 색상 성분 중 가장 큰 값으로 판단
            const max = Math.max(r, g, b);
            if (max === r && r > 150) return '🔴';
            if (max === g && g > 150) return '🟢';
            if (max === b && b > 150) return '🔵';
            if (r > 150 && g > 150 && b < 100) return '🟡';
            if (r > 150 && b > 150) return '🟣';
            if (r > 150 && g > 100) return '🟠';
        }

        return null;
    }

    private getEmojiFromIconType(iconType: string): string | null {
        const iconMap: { [key: string]: string } = {
            'collection': '📁',
            'folder': '📂',
            'book': '📖',
            'document': '📄',
            'note': '📝',
            'bookmark': '🔖',
            'tag': '🏷️',
            'star': '⭐',
            'heart': '❤️',
            'home': '🏠',
            'work': '💼',
            'project': '📋',
            'idea': '💡',
            'meeting': '🤝'
        };

        return iconMap[iconType.toLowerCase()] || null;
    }

    private getEmojiFromName(name: string): string | null {
        if (!name) return null;

        const nameToEmoji: { [key: string]: string } = {
            '문서': '📄', 'document': '📄', 'doc': '📄',
            '프로젝트': '📁', 'project': '📁',
            '회의': '🤝', 'meeting': '🤝',
            '아이디어': '💡', 'idea': '💡',
            '메모': '📝', 'memo': '📝', 'note': '📝',
            '할일': '✅', 'todo': '✅', 'task': '✅',
            '개발': '💻', 'dev': '💻', 'development': '💻', 'code': '💻',
            '디자인': '🎨', 'design': '🎨',
            '마케팅': '📈', 'marketing': '📈',
            '인사': '👥', 'hr': '👥', 'people': '👥',
            '재무': '💰', 'finance': '💰',
            '법무': '⚖️', 'legal': '⚖️',
            '연구': '🔬', 'research': '🔬',
            '교육': '📚', 'education': '📚', 'learning': '📚',
            '고객': '👤', 'customer': '👤', 'client': '👤',
            '관심': '⭐', 'interest': '⭐', 'favorite': '⭐',
            '자료': '📄', 'material': '📄', 'resource': '📄'
        };

        const collectionName = name.toLowerCase();
        for (const [keyword, emoji] of Object.entries(nameToEmoji)) {
            if (collectionName.includes(keyword.toLowerCase())) {
                return emoji;
            }
        }

        return null;
    }

    private getDefaultEmoji(identifier: string): string {
        const defaultEmojis = ['📁', '📂', '📋', '📌', '📖', '📘', '📙', '📗', '📕', '📓'];
        const index = Math.abs(this.hashCode(identifier || '기본')) % defaultEmojis.length;
        return defaultEmojis[index];
    }

    private getDefaultCollectionIcon(collection: any): string {
        console.log('기본 아이콘 생성 중, 컬렉션:', collection);

        // 컬렉션 색상에 따른 이모지 매핑
        const colorToEmoji: { [key: string]: string } = {
            'red': '🔴',
            'orange': '🟠',
            'yellow': '🟡',
            'green': '🟢',
            'blue': '🔵',
            'purple': '🟣',
            'pink': '🩷',
            'brown': '🟤',
            'gray': '⚫',
            'grey': '⚫'
        };

        // 컬렉션 이름에 따른 이모지 매핑 (한국어 + 영어)
        const nameToEmoji: { [key: string]: string } = {
            '문서': '📄', 'document': '📄', 'doc': '📄',
            '프로젝트': '📁', 'project': '📁',
            '회의': '🤝', 'meeting': '🤝',
            '아이디어': '💡', 'idea': '💡',
            '메모': '📝', 'memo': '📝', 'note': '📝',
            '할일': '✅', 'todo': '✅', 'task': '✅',
            '개발': '💻', 'dev': '💻', 'development': '💻', 'code': '💻',
            '디자인': '🎨', 'design': '🎨',
            '마케팅': '📈', 'marketing': '📈',
            '인사': '👥', 'hr': '👥', 'people': '👥',
            '재무': '💰', 'finance': '💰',
            '법무': '⚖️', 'legal': '⚖️',
            '연구': '🔬', 'research': '🔬',
            '교육': '📚', 'education': '📚', 'learning': '📚',
            '고객': '👤', 'customer': '👤', 'client': '👤'
        };

        // 색상으로 아이콘 찾기
        if (collection.color) {
            console.log('컬렉션 색상:', collection.color);
            const colorIcon = colorToEmoji[collection.color.toLowerCase()];
            if (colorIcon) {
                console.log('색상 기반 아이콘:', colorIcon);
                return colorIcon;
            }
        }

        // 이름으로 아이콘 찾기
        if (collection.name) {
            const collectionName = collection.name.toLowerCase();
            console.log('컬렉션 이름:', collectionName);

            for (const [keyword, emoji] of Object.entries(nameToEmoji)) {
                if (collectionName.includes(keyword.toLowerCase())) {
                    console.log(`키워드 "${keyword}" 매칭, 아이콘:`, emoji);
                    return emoji;
                }
            }
        }

        // 기본 이모지들 중 일관된 선택
        const defaultEmojis = ['📁', '📂', '📋', '📌', '📖', '📘', '📙', '📗', '📕', '📓'];
        const index = Math.abs(this.hashCode(collection.name || collection.id || '기본')) % defaultEmojis.length;
        const defaultIcon = defaultEmojis[index];
        console.log('기본 아이콘 선택:', defaultIcon, 'index:', index);
        return defaultIcon;
    }

    private hashCode(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 32bit integer로 변환
        }
        return hash;
    }
}


