// netlify/functions/analyze.js
export default async (req, context) => {
  // Netlify 现在不强制要求检查请求方法，但为了规范，我们可以自己加个判断
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { target, metrics, apiKey, model } = body;
    
    // 优先使用前端传过来的 Key 和模型，否则使用环境变量
    const finalKey = apiKey || Netlify.env.get('ROXY_API_KEY');
    const finalModel = model || 'gpt-6-astra';

    if (!target || !Array.isArray(metrics) || !finalKey) {
      return new Response(JSON.stringify({ error: '参数不完整：需要 target、metrics 和 apiKey' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const prompt =
      '你是深空天体研判助手，面向天文学家输出简明的研判结论。' +
      '请根据以下观测数据，用一段话（不超过120字，中文）给出该候选目标的研判结论，' +
      '先指出主要优势，再指出主要风险，不要输出标题或列表。\n\n' +
      '目标：' + target.name + '（' + target.sub + '）\n' +
      '指标：光谱匹配度 ' + metrics[0] + '%，大气特征 ' + metrics[1] +
      '%，轨道稳定性 ' + metrics[2] + '%，信号强度 ' + metrics[3] +
      '%，宜居指数 ' + metrics[4] + '%。';

    const upstream = await fetch('https://api.kie.ai/codex/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${finalKey}`
      },
      body: JSON.stringify({
        model: finalModel,
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

    const data = await upstream.json().catch(() => ({}));

    const bodyErr =
      (data.code && data.code !== 200 && data.code !== 0) ||
      data.error;

    if (!upstream.ok || bodyErr) {
      const msg =
        (data.error && (data.error.message || data.error)) ||
        data.msg ||
        ('上游返回异常（HTTP ' + upstream.status + '）');
      return new Response(JSON.stringify({ error: String(msg) }), {
        status: upstream.ok ? 502 : upstream.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const messageItem = (data.output || []).find(o => o.type === 'message');
    let text = messageItem && messageItem.content && messageItem.content[0] && messageItem.content[0].text;

    if (text && typeof text === 'object') text = text.value || '';
    if (!text && typeof data.output_text === 'string') text = data.output_text;

    if (!text) {
      return new Response(JSON.stringify({ error: '上游未返回文本内容', raw: data }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ analysis: text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: '函数内部崩溃: ' + error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
