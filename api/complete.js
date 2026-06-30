export default async function handler(req, res) {
  const { blockId } = req.query;

  if (!blockId) {
    return res.status(400).send('blockId가 없습니다.');
  }

  const response = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to_do: { checked: true } }),
  });

  if (!response.ok) {
    const err = await response.text();
    return res.status(500).send(`Notion 오류: ${err}`);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>완료!</title>
  <style>
    body { font-family: -apple-system, sans-serif; text-align: center; padding: 60px 20px; background: #f9f9f9; }
    h1 { font-size: 3rem; margin-bottom: 12px; }
    p { color: #555; font-size: 1.1rem; }
    a { display: inline-block; margin-top: 24px; padding: 12px 24px;
        background: #000; color: #fff; border-radius: 8px; text-decoration: none; font-size: 1rem; }
  </style>
</head>
<body>
  <h1>✅</h1>
  <p>할 일이 완료 처리됐어요!</p>
  <a href="https://www.notion.so/30bb8f52b84f80999186e42ccce1968f">Notion 열기</a>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`);
}
