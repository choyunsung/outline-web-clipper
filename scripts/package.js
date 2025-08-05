const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const releasesDir = path.join(projectRoot, 'releases');
const distDir = path.join(projectRoot, 'dist');

try {
  // releases 디렉토리가 없으면 생성
  if (!fs.existsSync(releasesDir)) {
    fs.mkdirSync(releasesDir, { recursive: true });
    console.log('✅ releases 디렉토리가 생성되었습니다.');
  }

  // 빌드 실행
  console.log('🔨 프로젝트를 빌드 중입니다...');
  execSync('npm run build', { stdio: 'inherit', cwd: projectRoot });

  // ZIP 파일 생성
  console.log('📦 ZIP 파일을 생성 중입니다...');
  const zipPath = path.join(releasesDir, 'outline-clipper.zip');
  
  // 기존 ZIP 파일 삭제 (있다면)
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // bestzip으로 압축
  execSync(`npx bestzip ${zipPath} *`, { 
    stdio: 'inherit', 
    cwd: distDir 
  });

  console.log('✅ 패키지가 성공적으로 생성되었습니다:', zipPath);
  
  // 파일 크기 정보 출력
  const stats = fs.statSync(zipPath);
  const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`📏 파일 크기: ${fileSizeInMB} MB`);

} catch (error) {
  console.error('❌ 패키지 생성 중 오류가 발생했습니다:', error.message);
  process.exit(1);
}
