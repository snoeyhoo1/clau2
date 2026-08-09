// scripts/generate-vapid-keys.js
// 푸시 알림에 필요한 VAPID 키 쌍을 생성한다.
// 실행: npm run generate-vapid-keys
// 출력된 값을 Vercel 프로젝트의 Environment Variables에 등록해야 함.

const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('\n=== VAPID 키 생성 완료 ===\n');
console.log('아래 값을 Vercel 프로젝트 설정 > Environment Variables에 등록하세요:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   (본인 이메일로 교체)');
console.log('\n그리고 app.js가 공개키를 알 수 있도록, 아래 값을 app.js 상단의');
console.log('VAPID_PUBLIC_KEY 변수에도 똑같이 붙여넣으세요:\n');
console.log(keys.publicKey);
console.log('');
