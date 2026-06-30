import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Client } from '@notionhq/client';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.NOTION_API_KEY) {
  dotenv.config({ path: resolve(__dirname, '../src/.env') });
}

const PAGE_ID = '30bb8f52b84f80999186e42ccce1968f';
const NOTION_PAGE_URL = `https://www.notion.so/${PAGE_ID}`;
const notion = new Client({ auth: process.env.NOTION_API_KEY });

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

async function sendKakao(templateObject, accessToken) {
  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
  });
  const result = await res.json();
  if (result.result_code !== 0) throw new Error(`카카오 전송 실패: ${JSON.stringify(result)}`);
  console.log('카카오톡 전송 완료');
}

// 리스트 템플릿: 항목마다 탭하면 완료 처리 (VERCEL_URL 필요)
async function sendListTemplate(unchecked, checked, today, accessToken) {
  const vercelUrl = process.env.VERCEL_URL;
  const chunks = [];

  // 5개씩 나눠 전송 (카카오 list 템플릿 최대 5개)
  for (let i = 0; i < unchecked.length; i += 5) {
    chunks.push(unchecked.slice(i, i + 5));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const headerTitle = ci === 0
      ? `📋 TO-DO LIST — ${today}`
      : `📋 TO-DO LIST (계속) — ${ci + 1}/${chunks.length}`;

    const items = chunk.map(block => {
      const text = block.to_do.rich_text.map(t => t.plain_text).join('');
      const completeUrl = `${vercelUrl}/api/complete?blockId=${block.id}`;
      return {
        title: `☐  ${text}`,
        description: '탭하면 완료 처리',
        link: { web_url: completeUrl, mobile_web_url: completeUrl },
      };
    });

    const template = {
      object_type: 'list',
      header_title: headerTitle,
      header_link: { web_url: NOTION_PAGE_URL, mobile_web_url: NOTION_PAGE_URL },
      items,
      buttons: [
        {
          title: `✅ ${checked.length}완료  ☐ ${unchecked.length}남음`,
          link: { web_url: NOTION_PAGE_URL, mobile_web_url: NOTION_PAGE_URL },
        },
      ],
    };

    await sendKakao(template, accessToken);
    if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
}

// 텍스트 템플릿: 간격 추가된 기본 메시지
async function sendTextTemplate(unchecked, checked, today, accessToken) {
  let message = `📋 TO-DO LIST — ${today}\n${'─'.repeat(24)}\n\n`;

  if (unchecked.length === 0) {
    message += '🎉 오늘 할 일을 모두 완료했어요!\n';
  } else {
    unchecked.forEach((block, i) => {
      const text = block.to_do.rich_text.map(t => t.plain_text).join('');
      message += `${i + 1}. ☐  ${text}\n\n`;
    });
  }

  message += `${'─'.repeat(24)}\n`;
  message += `✅ ${checked.length}개 완료  ·  ☐ ${unchecked.length}개 남음`;

  await sendKakao({
    object_type: 'text',
    text: message.slice(0, 9000),
    link: { web_url: NOTION_PAGE_URL, mobile_web_url: NOTION_PAGE_URL },
  }, accessToken);
}

async function getPageBlocks() {
  const res = await notion.blocks.children.list({ block_id: PAGE_ID, page_size: 100 });
  return res.results;
}

async function sortUncheckedToBottom(blocks) {
  const todos = blocks.filter(b => b.type === 'to_do');
  const unchecked = todos.filter(b => !b.to_do.checked);

  if (unchecked.length === 0) {
    console.log('모든 항목 완료 — 정렬 불필요');
    return;
  }

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
    await notion.blocks.delete({ block_id: block.id });
    await notion.blocks.children.append({
      block_id: PAGE_ID,
      children: [{ type: 'to_do', to_do: { rich_text: block.to_do.rich_text, checked: false } }],
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

  const vercelUrl = process.env.VERCEL_URL;

  if (vercelUrl && unchecked.length >= 2) {
    // Vercel 배포 후: 리스트 템플릿 (탭 → 완료 처리)
    await sendListTemplate(unchecked, checked, today, accessToken);
  } else {
    // Vercel 미배포 or 항목 1개 이하: 간격 있는 텍스트 템플릿
    await sendTextTemplate(unchecked, checked, today, accessToken);
  }

  await sortUncheckedToBottom(blocks);

  console.log('== 완료 ==');
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
