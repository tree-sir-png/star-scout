// netlify/functions/analyze.js
export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { target, metrics, apiKey, model } = body;
    
    // 获取密钥，优先用前端传的
    const finalKey = apiKey || Netlify.env.get('ROXY_API_KEY');
    const finalModel = model || 'gpt-6-astra';

    if (!target || !Array.isArray(metrics) || !finalKey) {
      return new Response(JSON.stringify({ error: '参数不完整' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
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

    // ⚠️⚠️⚠️ 注意这里：改成 RoxyAI 给你的中转接口地址！
    const ROXY_URL = 'https://www.roxyai.online/v1'; 
    
    // 注意：中转站通常使用标准的 Chat Completions 格式
    const upstream = await fetch(ROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${finalKey}`
      },
      body: JSON.stringify({
        model: finalModel,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await upstream.json().catch(() => ({}));

    // 兼容各种中转站的报错格式
    if (!upstream.ok || data.error) {
      const msg = data.error?.message || data.error || data.msg || ('HTTP ' + upstream.status);
      return new Response(JSON.stringify({ error: String(msg) }), {
        status: upstream.ok ? 502 : upstream.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 中转站通常返回 Chat Completions 格式
    let text = data.choices?.[0]?.message?.content;
    
    // 兼容有些中转可能支持新版 responses 格式
    if (!text && data.output) {
        const messageItem = (data.output || []).find(o => o.type === 'message');
        text = messageItem?.content?.[0]?.text;
    }

    if (!text) {
      return new Response(JSON.stringify({ error: '未返回文本', raw: data }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ analysis: text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: '内部崩溃: ' + error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
