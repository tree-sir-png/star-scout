// api/analyze.js
// 依赖环境变量：ROXY_API_KEY（在 RoxyAI 控制台生成的 sk- 密钥）
// 上游：kie.ai · gpt-6-astra · Responses API

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { target, metrics } = req.body || {};
  if (!target || !Array.isArray(metrics) || metrics.length < 5) {
    return res.status(400).json({ error: '参数不完整：需要 target 与 5 项 metrics' });
  }

  const prompt =
    '你是深空天体研判助手，面向天文学家输出简明的研判结论。' +
    '请根据以下观测数据，用一段话（不超过120字，中文）给出该候选目标的研判结论，' +
    '先指出主要优势，再指出主要风险，不要输出标题或列表。\n\n' +
    '目标：' + target.name + '（' + target.sub + '）\n' +
    '指标：光谱匹配度 ' + metrics[0] + '%，大气特征 ' + metrics[1] +
    '%，轨道稳定性 ' + metrics[2] + '%，信号强度 ' + metrics[3] +
    '%，宜居指数 ' + metrics[4] + '%。';

  let upstream;
  try {
    upstream = await fetch('https://api.kie.ai/codex/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ROXY_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-6-astra',
        stream: false,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: prompt }]
          }
        ],
        reasoning: { effort: 'medium' }
      })
    });
  } catch (e) {
    return res.status(502).json({ error: '无法连接上游：' + e.message });
  }

  const data = await upstream.json().catch(() => ({}));

  // kie.ai 可能返回 HTTP 200 + { code, msg } 的错误形态，需要双重判断
  const bodyErr =
    (data.code && data.code !== 200 && data.code !== 0) ||
    data.error;

  if (!upstream.ok || bodyErr) {
    const msg =
      (data.error && (data.error.message || data.error)) ||
      data.msg ||
      ('上游返回异常（HTTP ' + upstream.status + '）');
    return res.status(upstream.ok ? 502 : upstream.status).json({ error: String(msg) });
  }

  // Responses API 的文本在 output 里 type === "message" 的 content[0].text
  const messageItem = (data.output || []).find(o => o.type === 'message');
  let text = messageItem && messageItem.content && messageItem.content[0] && messageItem.content[0].text;

  // 兜底：兼容个别实现把 text 包成 { value } 或直接放在 output_text
  if (text && typeof text === 'object') text = text.value || '';
  if (!text && typeof data.output_text === 'string') text = data.output_text;

  if (!text) {
    return res.status(502).json({ error: '上游未返回文本内容', raw: data });
  }

  return res.status(200).json({ analysis: text });
}
