import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Client } from '@notionhq/client';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 로컬 실행 시 src/.env 로드
if (!process.env.NOTION_API_KEY) {
  dotenv.config({ path: resolve(__dirname, '../src/.env') });
}

const PAGE_ID = '30bb8f52b84f80999186e42ccce1968f';
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// 카카오 액세스 토큰 갱신 (매일 만료되므로 refresh_token으로 갱신)
async function refreshKakaoToken() {
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.KAKAO_REST_API_KEY,
      refresh_token: process.env.KAKAO_REFRESH_TOKEN,
      client_secret: process.env.KAKAO_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`카카오 토큰 갱신 실패: ${data.error_description}`);
  console.log('카카오 토큰 갱신 완료');
  return data.access_token;
}

// 카카오 나에게 메시지 전송
async function sendKakaoMessage(text, accessToken) {
  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      template_object: JSON.stringify({
        object_type: 'text',
        text: text.slice(0, 9000),
        link: {
          web_url: `https://www.notion.so/${PAGE_ID}`,
          mobile_web_url: `https://www.notion.so/${PAGE_ID}`,
        },
      }),
    }),
  });
  const result = await res.json();
  if (result.result_code !== 0) {
    throw new Error(`카카오 전송 실패: ${JSON.stringify(result)}`);
  }
  console.log('카카오톡 전송 완료');
}

// Notion 페이지 블록 가져오기
async function getPageBlocks() {
  const res = await notion.blocks.children.list({ block_id: PAGE_ID, page_size: 100 });
  return res.results;
}

// 미완료(unchecked) 항목을 맨 아래로 정렬
async function sortUncheckedToBottom(blocks) {
  const todos = blocks.filter(b => b.type === 'to_do');
  const unchecked = todos.filter(b => !b.to_do.checked);

  if (unchecked.length === 0) {
    console.log('모든 항목 완료 — 정렬 불필요');
    return;
  }

  // 이미 정렬됐는지 확인 (마지막 checked 인덱스 < 첫 unchecked 인덱스)
  const checkedIndices = todos.map((b, i) => b.to_do.checked ? i : -1).filter(i => i >= 0);
  const uncheckedIndices = todos.map((b, i) => !b.to_do.checked ? i : -1).filter(i => i >= 0);
  const lastChecked = Math.max(...checkedIndices, -1);
  const firstUnchecked = Math.min(...uncheckedIndices);

  if (firstUnchecked > lastChecked) {
    console.log('이미 올바르게 정렬됨 — 스킵');
    return;
  }

  console.log(`미완료 항목 ${unchecked.length}개 아래로 이동 중...`);

  for (const block of unchecked) {
    const richText = block.to_do.rich_text;
    await notion.blocks.delete({ block_id: block.id });
    await notion.blocks.children.append({
      block_id: PAGE_ID,
      children: [{ type: 'to_do', to_do: { rich_text: richText, checked: false } }],
    });
  }

  console.log('Notion 정렬 완료');
}

async function main() {
  console.log('== 오전 할 일 알림 시작 ==');

  const accessToken = await refreshKakaoToken();
  const blocks = await getPageBlocks();

  const todos = blocks.filter(b => b.type === 'to_do');
  const unchecked = todos.filter(b => !b.to_do.checked);
  const checked = todos.filter(b => b.to_do.checked);

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    timeZone: 'Asia/Seoul',
  });

  let message = `📋 TO-DO LIST — ${today}\n${'─'.repeat(24)}\n`;

  if (unchecked.length === 0) {
    message += '🎉 오늘 할 일을 모두 완료했어요!\n';
  } else {
    for (const block of unchecked) {
      const text = block.to_do.rich_text.map(t => t.plain_text).join('');
      message += `☐  ${text}\n`;
    }
  }

  message += `${'─'.repeat(24)}\n`;
  message += `✅ ${checked.length}개 완료  ·  ☐ ${unchecked.length}개 남음`;

  await sendKakaoMessage(message, accessToken);
  await sortUncheckedToBottom(blocks);

  console.log('== 완료 ==');
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
