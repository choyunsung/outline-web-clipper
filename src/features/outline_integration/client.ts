// src/features/outline_integration/client.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import {OutlineConfig, Collection, ImageInfo} from '../../types';
import { UploadStateStorage } from '../storage/upload-state';

export class OutlineClient {
    private apiUrl: string;
    private apiToken: string;
    private axiosInstance: AxiosInstance;

    constructor(config: OutlineConfig) {
        this.apiUrl = config.apiUrl.replace(/\/$/, '');
        this.apiToken = config.apiToken;

        // Axios 인스턴스 생성 (Cookie 없이 Authorization만 사용)
        this.axiosInstance = axios.create({
            baseURL: this.apiUrl,
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            timeout: 30000, // 30초 타임아웃
            withCredentials: false, // Cookie 전송 비활성화
        });

        // 요청 인터셉터
        this.axiosInstance.interceptors.request.use(
            (config) => {
                // Cookie 헤더가 있다면 제거
                if (config.headers && config.headers.Cookie) {
                    delete config.headers.Cookie;
                }
                // withCredentials를 명시적으로 false로 설정
                config.withCredentials = false;

                console.log(`API 요청: ${config.method?.toUpperCase()} ${config.url}`);
                return config;
            },
            (error) => {
                console.error('요청 오류:', error);
                return Promise.reject(error);
            }
        );

        // 응답 인터셉터
        this.axiosInstance.interceptors.response.use(
            (response) => {
                console.log(`API 응답: ${response.status} ${response.config.url}`);
                return response;
            },
            (error: AxiosError) => {
                if (error.response) {
                    console.error(`API 오류: ${error.response.status} ${error.response.statusText}`);
                    console.error('오류 데이터:', error.response.data);
                } else if (error.request) {
                    console.error('응답 없음:', error.request);
                } else {
                    console.error('요청 설정 오류:', error.message);
                }
                return Promise.reject(error);
            }
        );
    }

    async testConnection(): Promise<boolean> {
        try {
            const response = await this.axiosInstance.post('/api/auth.info');
            return response.status === 200;
        } catch (error) {
            console.error('연결 테스트 실패:', error);
            return false;
        }
    }

    async uploadImage(imageUrl: string, retryCount: number = 0): Promise<string> {
        const maxRetries = 3;
        const retryDelay = 1000 * Math.pow(2, retryCount);

        try {
            console.log('이미지 업로드 시작:', imageUrl, retryCount > 0 ? `(재시도 ${retryCount}/${maxRetries})` : '');

            let blob: Blob;
            let mimeType: string;

            // data URL인 경우 직접 처리
            if (imageUrl.startsWith('data:')) {
                const [header, base64Data] = imageUrl.split(',');
                mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/png';
                const binaryString = atob(base64Data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                blob = new Blob([bytes], { type: mimeType });
            } else {
                // 일반 URL의 경우 - fetch 직접 사용
                try {
                    const imageResponse = await fetch(imageUrl);
                    if (!imageResponse.ok) {
                        throw new Error(`HTTP error! status: ${imageResponse.status}`);
                    }
                    blob = await imageResponse.blob();
                    // content-type에서 charset 및 기타 매개변수 제거
                    const contentType = imageResponse.headers.get('content-type') || 'image/png';
                    mimeType = contentType.split(';')[0].trim();
                } catch (fetchError: any) {
                    // CORS 또는 CSP 오류 시 원본 URL 반환
                    console.warn('이미지 다운로드 실패, 원본 URL 사용:', imageUrl, fetchError.message);
                    return imageUrl;
                }
            }

            // Blob 크기와 타입 확인
            if (blob.size > 10 * 1024 * 1024) {
                throw new Error(`이미지 파일이 너무 큽니다: ${Math.round(blob.size / 1024 / 1024)}MB`);
            }

            // MIME 타입 정리 (차서 charset 등 제거)
            mimeType = mimeType.split(';')[0].trim();

            if (!mimeType.startsWith('image/')) {
                throw new Error(`이미지가 아닌 파일: ${mimeType}`);
            }

            const fileName = this.generateFileName(imageUrl, mimeType);
            console.log('생성된 파일명:', fileName);

            // 1단계: attachments.create → 업로드 URL 및 필드 수신
            // 명시적으로 Authorization 헤더 포함하여 별도 요청
            const metaResponse = await axios.post(
                `${this.apiUrl}/api/attachments.create`,
                {
                    name: fileName,
                    contentType: mimeType,
                    size: blob.size
                    // documentId는 생략 (문서 생성 전이므로 포함하지 않음)
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    withCredentials: false
                }
            );

            console.log('Attachment creation response:', metaResponse.data);
            const { data } = metaResponse.data;

            // 업로드 URL 및 form 데이터 처리
            const uploadForm = new FormData();

            // form 필드가 있으면 presigned URL (예: S3)
            if (data.form && Object.keys(data.form).length > 0) {
                // presigned fields 추가
                for (const [key, value] of Object.entries(data.form)) {
                    uploadForm.append(key, value as string);
                }
                // 파일은 마지막에 추가 (S3 요구사항)
                uploadForm.append('file', new File([blob], fileName, { type: mimeType }));
            } else {
                // form이 없으면 직접 업로드 (Outline API)
                uploadForm.append('file', new File([blob], fileName, { type: mimeType }));
                // attachment ID 추가 (필요한 경우)
                if (data.attachment?.id) {
                    uploadForm.append('attachmentId', data.attachment.id);
                }
            }

            // 업로드 URL 구성
            let uploadUrl: string;
            if (data.uploadUrl.startsWith('http')) {
                // 전체 URL
                uploadUrl = data.uploadUrl;
            } else if (data.uploadUrl.startsWith('/')) {
                // 상대 경로
                uploadUrl = `${this.apiUrl}${data.uploadUrl}`;
            } else {
                // 기타 경우
                uploadUrl = `${this.apiUrl}/${data.uploadUrl}`;
            }

            console.log('Uploading to:', uploadUrl);

            // 파일 업로드
            const uploadResponse = await axios.post(uploadUrl, uploadForm, {
                headers: {
                    // Outline API 엔드포인트인 경우 Authorization 헤더 포함
                    ...(data.uploadUrl.includes('/api/') ? {
                        'Authorization': `Bearer ${this.apiToken}`
                    } : {}),
                    // Content-Type은 FormData에 대해 브라우저가 자동 설정
                },
                withCredentials: false,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            console.log('Upload response status:', uploadResponse.status);

            if (uploadResponse.status !== 200 && uploadResponse.status !== 201 && uploadResponse.status !== 204) {
                throw new Error(`파일 업로드 실패: ${uploadResponse.status}`);
            }

            // 업로드된 파일 URL 반환
            // attachment URL이 상대 경로인 경우 apiUrl 추가
            const fileUrl = data.attachment.url.startsWith('http')
                ? data.attachment.url
                : `${this.apiUrl}${data.attachment.url}`;
            console.log('업로드 성공:', fileUrl);
            return fileUrl;

        } catch (error: any) {
            // 401 오류 처리
            if (error.response?.status === 401) {
                console.error('인증 오류: API 토큰이 유효하지 않거나 권한이 부족합니다.');
                console.error('응답 데이터:', error.response.data);
                // 원본 URL 반환하여 문서는 생성되도록 함
                return imageUrl;
            }

            // Rate limit 오류
            if (error.response?.status === 429 && retryCount < maxRetries) {
                const backoffDelay = retryDelay * Math.pow(2, retryCount); // 지수 백오프
                console.log(`Rate limit 오류, ${backoffDelay}ms 후 재시도... (시도 ${retryCount + 1}/${maxRetries})`);
                await this.delay(backoffDelay);
                return this.uploadImage(imageUrl, retryCount + 1);
            }

            console.error('이미지 업로드 오류:', error.response?.status || error.message);
            console.error('오류 상세:', error.response?.data || error);
            return imageUrl; // 실패 시 원본 URL 반환
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private generateFileName(url: string, mimeType: string): string {
        // MIME 타입에서 charset 및 기타 매개변수 제거
        const cleanMimeType = mimeType.split(';')[0].trim();
        let extension = cleanMimeType.split('/')[1] || 'png';

        // 특수 MIME 타입 처리
        const extensionMap: { [key: string]: string } = {
            'svg+xml': 'svg',
            'jpeg': 'jpg',
            'x-icon': 'ico',
            'x-png': 'png',
            'x-gif': 'gif'
        };

        if (extensionMap[extension]) {
            extension = extensionMap[extension];
        }

        const timestamp = Date.now();

        try {
            const urlObject = new URL(url);
            const pathParts = urlObject.pathname.split('/');
            const lastSegment = decodeURIComponent(pathParts[pathParts.length - 1]);
            const cleanName = lastSegment.split('?')[0];

            if (cleanName && cleanName.includes('.') && cleanName.length < 100) {
                // 파일명에서 확장자 추출
                const nameExt = cleanName.split('.').pop()?.toLowerCase();
                // 알려진 이미지 확장자인지 확인
                if (nameExt && ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(nameExt)) {
                    return cleanName;
                }
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
        try {
            const response = await this.axiosInstance.post('/api/documents.create', {
                title,
                text: content,
                collectionId,
                publish: options?.publish ?? true,
                parentDocumentId: options?.parentDocumentId,
            });

            return response.data;
        } catch (error: any) {
            console.error('Document create error:', error.response?.data || error.message);
            throw new Error(`Outline API 오류: ${error.response?.data?.message || error.message}`);
        }
    }

    async updateDocument(
        documentId: string,
        updates: {
            title?: string;
            text?: string;
            publish?: boolean;
        }
    ): Promise<any> {
        try {
            const response = await this.axiosInstance.post('/api/documents.update', {
                id: documentId,
                ...updates
            });

            return response.data;
        } catch (error) {
            throw new Error('문서 업데이트 실패');
        }
    }

    async getCollections(includeDocuments: boolean = false): Promise<Collection[]> {
        try {
            const response = await this.axiosInstance.post('/api/collections.list', {
                limit: 100,
            });

            const collections = response.data.data || [];
            await this.processCollections(collections, includeDocuments);
            return collections;
        } catch (error: any) {
            console.error('Collections list error:', error.response?.data || error.message);
            throw new Error('컬렉션 목록을 가져올 수 없습니다');
        }
    }

    private async processCollections(collections: any[], includeDocuments: boolean) {
        console.log('Outline API 응답 컬렉션:', collections);

        // 컬렉션에 아이콘 설정
        collections.forEach((collection: any) => {
            // console.log('컬렉션 처리 중:', collection);
            collection.icon = this.getCollectionEmoji(collection);
            // console.log(`최종 아이콘 설정: ${collection.icon}`);
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
    }

    async getCollectionDocuments(collectionId: string): Promise<any[]> {
        try {
            const response = await this.axiosInstance.post('/api/documents.list', {
                collectionId,
                limit: 100,
            });

            const documents = response.data.data || [];
            // 계층 구조 구성
            return this.buildDocumentTree(documents);
        } catch (error) {
            throw new Error('문서 목록을 가져올 수 없습니다');
        }
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
        try {
            const response = await this.axiosInstance.post('/api/documents.search', {
                query,
                limit: 10,
                includeArchived: false
            });

            return response.data;
        } catch (error) {
            console.error('문서 검색 오류:', error);
            return { data: [] };
        }
    }

    async processImagesInContent(content: string, images: ImageInfo[], onProgress?: (current: number, total: number) => void): Promise<string> {
        let processedContent = content;
        let successCount = 0;
        let failCount = 0;

        // GitHub 페이지의 경우 필터링 건너뛰기
        const isGitHub = content.includes('github.com') && images.some(img =>
            img.originalUrl.includes('camo.githubusercontent.com')
        );

        let contentImages = images;

        if (!isGitHub) {
            // 일반 페이지의 경우에만 필터링
            console.log(`\n🔍 이미지 필터링 시작: 총 ${images.length}개`);

            // 디버깅: 처음 10개 이미지 정보 출력
            console.log('📷 추출된 이미지 정보 (처음 10개):');
            images.slice(0, 10).forEach((img, idx) => {
                console.log(`  [${idx + 1}] ${img.originalUrl.substring(img.originalUrl.lastIndexOf('/') + 1)}`);
                console.log(`      - markdownUrl: ${img.markdownUrl}`);
                console.log(`      - isContentImage: ${img.isContentImage}`);
            });

            let filteredInCount = 0;
            let filteredOutCount = 0;

            contentImages = images.filter((img, index) => {
                // markdownUrl이 있으면 그것을 사용, 없으면 originalUrl 사용
                const urlToCheck = img.markdownUrl || img.originalUrl;

                // 1. 단순 문자열 포함 확인
                let isInContent = content.includes(urlToCheck);
                let foundMethod = isInContent ? 'direct' : '';

                // 2. HTML img 태그에서 확인 (src 속성의 URL이 다를 수 있음)
                if (!isInContent) {
                    // escape 처리된 URL로 정규식 생성
                    const escapedUrl = this.escapeRegExp(urlToCheck);
                    // HTML img 태그 패턴 확인 - 더 유연한 패턴 사용
                    // <img 뒤에 공백이 없을 수도 있고, src 전후에 다른 속성이 있을 수 있음
                    const htmlImgPattern1 = new RegExp(`<img[^>]*\\ssrc=["']${escapedUrl}["'][^>]*>`, 'gi');
                    const htmlImgPattern2 = new RegExp(`<img\\s+src=["']${escapedUrl}["'][^>]*>`, 'gi');
                    const htmlImgPattern3 = new RegExp(`src=["']${escapedUrl}["']`, 'gi');

                    isInContent = htmlImgPattern1.test(content) ||
                                 htmlImgPattern2.test(content) ||
                                 htmlImgPattern3.test(content);

                    if (isInContent) {
                        foundMethod = 'html';
                        console.log(`  ✅ HTML img 태그에서 발견: ${urlToCheck}`);
                    }
                }

                // 3. Markdown 이미지 패턴 확인
                if (!isInContent) {
                    const escapedUrl = this.escapeRegExp(urlToCheck);
                    const markdownPattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapedUrl}\\)`, 'g');
                    isInContent = markdownPattern.test(content);

                    if (isInContent) {
                        foundMethod = 'markdown';
                        console.log(`  ✅ Markdown 이미지에서 발견: ${urlToCheck}`);
                    }
                }

                // 통계 수집
                if (isInContent) {
                    filteredInCount++;
                    if (index < 10) {
                        console.log(`  ✅ 포함 [${index + 1}/${images.length}] (${foundMethod}): ${urlToCheck.substring(urlToCheck.lastIndexOf('/') + 1)}`);
                    }
                } else {
                    filteredOutCount++;
                    if (index < 10 || filteredOutCount <= 5) {
                        console.log(`  ❌ 제외 [${index + 1}/${images.length}]: ${urlToCheck.substring(urlToCheck.lastIndexOf('/') + 1)}`);

                        // 더 자세한 디버깅 정보
                        const filename = urlToCheck.substring(urlToCheck.lastIndexOf('/') + 1);
                        if (content.includes(filename)) {
                            console.log(`     ⚠️ 파일명은 있지만 전체 URL이 다름`);
                            // 파일명 주변 콘텐츠 확인
                            const idx = content.indexOf(filename);
                            const context = content.substring(Math.max(0, idx - 50), Math.min(content.length, idx + filename.length + 50));
                            console.log(`     주변 콘텐츠: ${context.replace(/\n/g, ' ')}`);
                        }
                    }
                }

                // isContentImage가 명시적으로 false가 아니거나, 콘텐츠에 포함된 경우만 처리
                return isInContent;
            });

            console.log(`\n📊 필터링 결과: ${images.length}개 → ${contentImages.length}개`);
        } else {
            console.log(`\n🐙 GitHub 페이지 감지: 모든 이미지 처리 (${images.length}개)`);
        }

        // 이미지 수 제한 (너무 많으면 rate limit 발생 가능)
        const maxImages = contentImages.length || 150; // 모든 이미지 처리 (필요시 제한 가능)
        const imagesToProcess = contentImages.slice(0, maxImages);

        if (contentImages.length > maxImages) {
            console.log(`이미지가 ${contentImages.length}개 발견되었지만, rate limiting 방지를 위해 처음 ${maxImages}개만 업로드합니다.`);
        }

        console.log(`처리할 이미지: ${imagesToProcess.length}개`);

        // 초기 콘텐츠의 이미지 URL 확인
        console.log('\n📋 초기 콘텐츠 분석:');

        // Markdown 이미지 패턴 확인
        const markdownPatterns = content.match(/!\[([^\]]*)\]\(([^)]+)\)/g);
        if (markdownPatterns) {
            console.log(`  Markdown 이미지 패턴 ${markdownPatterns.length}개 발견`);
        }

        // HTML img 태그 패턴 확인
        const htmlImgPatterns = content.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi);
        if (htmlImgPatterns) {
            console.log(`  HTML img 태그 ${htmlImgPatterns.length}개 발견`);
        }

        // 처리할 이미지와 콘텐츠의 이미지 매칭 확인
        if (imagesToProcess.length > 0) {
            console.log('\n🔍 이미지 매칭 확인:');
            imagesToProcess.slice(0, 5).forEach((img, idx) => {
                const urlToFind = img.markdownUrl || img.originalUrl;

                // 다양한 방식으로 이미지 존재 확인
                const directFound = content.includes(urlToFind);
                const escapedUrl = this.escapeRegExp(urlToFind);
                const htmlFound = new RegExp(`<img[^>]*\\ssrc=["']${escapedUrl}["'][^>]*>`, 'gi').test(content);
                const markdownFound = new RegExp(`!\\[[^\\]]*\\]\\(${escapedUrl}\\)`, 'g').test(content);

                console.log(`  [${idx + 1}] ${urlToFind.substring(urlToFind.lastIndexOf('/') + 1)}`);
                console.log(`       markdownUrl: ${img.markdownUrl}`);
                console.log(`       originalUrl: ${img.originalUrl}`);
                console.log(`       콘텐츠에 존재: ${directFound ? '✅ (직접)' : htmlFound ? '✅ (HTML)' : markdownFound ? '✅ (Markdown)' : '❌'}`);
            });
        }

        // 업로드 상태 저장
        await UploadStateStorage.setState({
            isUploading: true,
            currentIndex: 0,
            totalImages: imagesToProcess.length,
            startTime: Date.now(),
            shouldStop: false
        });

        // 진행 상황 알림
        if (onProgress) {
            onProgress(0, imagesToProcess.length);
        }

        // 완전한 순차 처리 (한 번에 하나씩, 응답 받은 후 다음 처리)
        for (let i = 0; i < imagesToProcess.length; i++) {
            // 중지 요청 확인
            const currentState = await UploadStateStorage.getState();
            if (currentState?.shouldStop) {
                console.log('⚠️ 사용자가 업로드를 중지했습니다.');
                chrome.notifications.create('upload-stopped', {
                    type: 'basic',
                    iconUrl: '/icon128.png',
                    title: '업로드 중지',
                    message: `${i}개 이미지 처리 후 중지됨`
                });
                break;
            }

            // 진행 상태 업데이트
            await UploadStateStorage.updateProgress(i, imagesToProcess.length);
            const image = imagesToProcess[i];

            if (!image.originalUrl) continue;

            try {
                console.log(`\n========== 이미지 ${i + 1}/${imagesToProcess.length} 처리 ==========`);
                console.log(`📍 이미지 정보:`);
                console.log(`  - originalUrl: ${image.originalUrl}`);
                console.log(`  - markdownUrl: ${image.markdownUrl}`);
                console.log(`  - alt: "${image.alt || '(없음)'}"`);

                // 현재 콘텐츠에 이 URL이 있는지 확인
                const urlToCheck = image.markdownUrl || image.originalUrl;
                const urlInContent = processedContent.includes(urlToCheck);
                console.log(`  - 교체할 URL: ${urlToCheck}`);
                console.log(`  - 현재 콘텐츠에 포함 여부: ${urlInContent}`);

                // 진행 상황 알림 표시 (취소 버튼 포함)
                chrome.notifications.create(`image-progress`, {
                    type: 'basic',
                    iconUrl: '/icon128.png',
                    title: '이미지 업로드 중',
                    message: `${i + 1}/${imagesToProcess.length} 처리 중...`,
                    buttons: [{ title: '중지' }],
                    requireInteraction: false,
                    silent: true
                });

                // 첫 번째 이미지가 아니면 지연 추가 (1초)
                if (i > 0) {
                    console.log('다음 이미지 처리 전 1초 대기...');
                    await this.delay(1000);
                }

                // 이미지 업로드 (응답 대기)
                const outlineUrl = await this.uploadImage(image.originalUrl);

                if (outlineUrl !== image.originalUrl) {
                    image.outlineUrl = outlineUrl;
                    successCount++;
                    console.log(`✅ 이미지 업로드 성공 (${i + 1}/${imagesToProcess.length}): ${outlineUrl}`);

                    // 성공한 이미지 URL 즉시 교체
                    // markdownUrl이 있으면 그것을 사용, 없으면 originalUrl 사용
                    const urlToReplace = image.markdownUrl || image.originalUrl;
                    console.log(`📋 URL 교체 정보:
                      - originalUrl: ${image.originalUrl}
                      - markdownUrl: ${image.markdownUrl}
                      - urlToReplace: ${urlToReplace}
                      - outlineUrl: ${outlineUrl}`);

                    processedContent = this.replaceImageUrlInContent(
                        processedContent,
                        urlToReplace,
                        outlineUrl
                    );

                    // 진행 상황 업데이트
                    if (onProgress) {
                        onProgress(i + 1, imagesToProcess.length);
                    }
                } else {
                    failCount++;
                    console.warn(`❌ 이미지 업로드 실패, 원본 URL 유지 (${i + 1}/${imagesToProcess.length}): ${image.originalUrl}`);
                }
            } catch (error: any) {
                failCount++;
                console.error(`❌ 이미지 업로드 오류 (${i + 1}/${imagesToProcess.length}): ${image.originalUrl}`, error.message);

                // Rate limit 오류인 경우 더 긴 대기
                if (error.response?.status === 429) {
                    console.log('Rate limit 감지, 5초 추가 대기...');
                    await this.delay(1000);
                }
            }
        }

        // 업로드 상태 삭제
        await UploadStateStorage.clearState();

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
        let replacementCount = 0;

        console.log(`\n🔍 URL 교체 시도:\n  원본: ${originalUrl}\n  대상: ${newUrl}`);
        // 콘텐츠 내 URL 존재 여부 확인
        console.log(`📝 콘텐츠 내 URL 포함 여부: ${updatedContent.includes(originalUrl)}`);

        // URL 일부분 존재 여부 확인
        const urlParts = originalUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        console.log(`📝 파일명 "${filename}" 포함 여부: ${updatedContent.includes(filename)}`);

        // 1. 먼저 단순 문자열 치환 시도 (가장 간단하고 효과적)
        if (updatedContent.includes(originalUrl)) {
            const beforeSimple = updatedContent;
            updatedContent = updatedContent.split(originalUrl).join(newUrl);
            const simpleReplacementCount = (beforeSimple.length - updatedContent.length) / (originalUrl.length - newUrl.length);
            if (beforeSimple !== updatedContent) {
                replacementCount = Math.abs(Math.round(simpleReplacementCount));
                console.log(`✅ 단순 문자열 치환 성공 (${replacementCount}개)`);
                return updatedContent;
            }
        } else {
            console.log(`⚠️ 단순 문자열 치환 실패: URL이 콘텐츠에 없음`);
        }

        // 2. 마크다운 이미지 태그에서 교체: ![alt](url) - escapeRegExp 사용
        const escapedUrl = this.escapeRegExp(originalUrl);
        const markdownImagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedUrl}\\)`, 'g');
        const beforeMarkdown = updatedContent;
        updatedContent = updatedContent.replace(markdownImagePattern, (match, alt) => {
            replacementCount++;
            return `![${alt}](${newUrl})`;
        });
        if (beforeMarkdown !== updatedContent) {
            console.log(`✅ Markdown 이미지 태그 교체 성공 (${replacementCount}개)`);
        }

        // 3. HTML img 태그의 src 속성에서 교체 (혹시 남아있는 경우)
        // <img src="url" ...> 형태 처리
        const htmlImgPattern = new RegExp(`(<img[^>]*\\ssrc=["'])${escapedUrl}(["'][^>]*>)`, 'gi');
        const beforeHtml = updatedContent;
        updatedContent = updatedContent.replace(htmlImgPattern, (match, prefix, suffix) => {
            replacementCount++;
            console.log(`  HTML img 태그 교체: ${match.substring(0, 100)}...`);
            return `${prefix}${newUrl}${suffix}`;
        });

        // <img src="url"> 형태 (속성이 없는 경우)도 처리
        const simpleHtmlImgPattern = new RegExp(`<img\\s+src=["']${escapedUrl}["']\\s*>`, 'gi');
        updatedContent = updatedContent.replace(simpleHtmlImgPattern, (match) => {
            replacementCount++;
            console.log(`  Simple HTML img 태그 교체: ${match}`);
            return `<img src="${newUrl}">`;
        });

        if (beforeHtml !== updatedContent) {
            console.log(`✅ HTML img 태그 교체 성공 (${replacementCount}개)`);
        }

        if (replacementCount === 0) {
            console.warn(`⚠️ URL 교체 실패: ${originalUrl}을(를) 찾을 수 없음`);

            // 디버깅: 콘텐츠에서 Markdown 이미지 URL 패턴 찾기
            const markdownImages = content.match(/!\[.*?\]\((.*?)\)/g);
            if (markdownImages) {
                console.log('📌 콘텐츠에 있는 Markdown 이미지들 (처음 5개):');
                markdownImages.slice(0, 5).forEach(url => {
                    console.log(`  - ${url}`);
                    // URL 부분만 추출
                    const urlMatch = url.match(/!\[.*?\]\((.*?)\)/);
                    if (urlMatch && urlMatch[1]) {
                        console.log(`    → URL: ${urlMatch[1]}`);
                        if (urlMatch[1] === originalUrl) {
                            console.log(`    ✓ 일치! 이 URL을 교체해야 함`);
                        } else if (urlMatch[1].includes(filename)) {
                            console.log(`    ⚠️ 파일명은 같지만 전체 경로가 다름`);
                            console.log(`      원본: ${originalUrl}`);
                            console.log(`      발견: ${urlMatch[1]}`);
                        }
                    }
                });
                console.log(`  ... 총 ${markdownImages.length}개의 Markdown 이미지가 있음`);
            } else {
                console.log('⚠️ 콘텐츠에 Markdown 이미지 패턴이 없음');
            }

            // HTML img 태그 패턴 찾기
            const htmlImages = content.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi);
            if (htmlImages) {
                console.log('📌 콘텐츠에 있는 HTML img 태그들 (처음 5개):');
                htmlImages.slice(0, 5).forEach(tag => {
                    console.log(`  - ${tag.substring(0, 100)}${tag.length > 100 ? '...' : ''}`);
                    // src 속성 추출
                    const srcMatch = tag.match(/src=["']([^"']+)["']/i);
                    if (srcMatch && srcMatch[1]) {
                        console.log(`    → src: ${srcMatch[1]}`);
                        if (srcMatch[1] === originalUrl) {
                            console.log(`    ✓ 일치! 이 src를 교체해야 함`);
                        } else if (srcMatch[1].includes(filename)) {
                            console.log(`    ⚠️ 파일명은 같지만 전체 경로가 다름`);
                            console.log(`      원본: ${originalUrl}`);
                            console.log(`      발견: ${srcMatch[1]}`);
                        }
                    }
                });
                console.log(`  ... 총 ${htmlImages.length}개의 HTML img 태그가 있음`);
            } else {
                console.log('⚠️ 콘텐츠에 HTML img 태그가 없음');
            }

            // 파일명 주변 콘텐츠 확인
            if (content.includes(filename)) {
                console.log(`📎 파일명 "${filename}"은 발견됨. 주변 콘텐츠 확인:`);
                const index = content.indexOf(filename);
                const start = Math.max(0, index - 100);
                const end = Math.min(content.length, index + filename.length + 100);
                const context = content.substring(start, end);
                // 줄바꿈을 공백으로 치환하여 한 줄로 표시
                console.log(`  컨텍스트: ${context.replace(/\n/g, ' ')}`);
            } else {
                console.log(`❌ 파일명 "${filename}"도 콘텐츠에 없음`);
            }
        } else {
            console.log(`✅ 총 ${replacementCount}개 위치에서 URL 교체 완료`);
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
        // console.log('아이콘 생성 중, 컬렉션:', collection);

        // 1. 색상 기반 이모지 (우선순위 1)
        if (collection.color) {
            const colorEmoji = this.getEmojiFromColor(collection.color);
            if (colorEmoji) {
                // console.log(`색상 ${collection.color}에서 이모지: ${colorEmoji}`);
                return colorEmoji;
            }
        }

        // 2. Outline 아이콘 타입 기반 이모지 (우선순위 2)
        if (collection.icon) {
            const iconEmoji = this.getEmojiFromIconType(collection.icon);
            if (iconEmoji) {
                // console.log(`아이콘 타입 ${collection.icon}에서 이모지: ${iconEmoji}`);
                return iconEmoji;
            }
        }

        // 3. 이름 기반 이모지 (우선순위 3)
        const nameEmoji = this.getEmojiFromName(collection.name);
        if (nameEmoji) {
            // console.log(`이름 ${collection.name}에서 이모지: ${nameEmoji}`);
            return nameEmoji;
        }

        // 4. 기본 이모지
        const defaultEmoji = this.getDefaultEmoji(collection.name || collection.id);
        // console.log(`기본 이모지: ${defaultEmoji}`);
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