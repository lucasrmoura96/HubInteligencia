/* ============================================================
   HUB AGROADVANCE — Worker proxy de IA (OpenAI)
   ------------------------------------------------------------
   Mantém a chave da OpenAI SEGURA (no servidor). O front-end manda
   só o RESUMO do recorte filtrado; o Worker chama o GPT e devolve
   o insight em texto.

   DEPLOY (resumo — passo a passo completo no chat):
     1. Conta grátis em https://dash.cloudflare.com  -> Workers
     2. Crie um Worker, cole este arquivo.
     3. Settings -> Variables and Secrets:
          OPENAI_API_KEY   = sua chave sk-... (tipo: Secret)
          ALLOWED_ORIGIN   = https://lucasrmoura96.github.io   (tipo: Text)
          HUB_TOKEN        = uma-string-aleatoria-qualquer       (tipo: Secret)
     4. Deploy. Copie a URL (ex: https://hub-ia.SEU.workers.dev)
        e cole em hub/assets/js/insight.js (INSIGHT_API_URL).
     5. Na OpenAI, defina um LIMITE DE GASTO mensal (proteção de custo).
   ============================================================ */

const MODELO = "gpt-4o-mini";   // barato e ótimo p/ análise; troque p/ "gpt-4o" se quiser mais profundidade
const MAX_TOKENS = 950;

const SYSTEM_PROMPT = `Você é um analista sênior de marketing e performance (B2C, cursos de pós/MBA do agronegócio) da Agroadvance.
Recebe um RESUMO de métricas já filtradas de um painel. Sua tarefa:
- Interpretar os números com olhar crítico de growth/CRM.
- Entregar valor acionável para o time, não obviedades.
Responda em português do Brasil, em markdown enxuto, com EXATAMENTE estas seções:
## Leitura rápida
(2-3 frases com o panorama do recorte)
## Pontos fortes
(bullets — o que está indo bem e por quê)
## Pontos fracos / riscos
(bullets — gargalos, quedas, números preocupantes)
## Oportunidades
(bullets — onde há ganho rápido escondido nos dados)
## Sugestões de estratégia
(bullets — ações concretas e priorizadas para as próximas semanas)
Regras: seja específico citando os números do resumo. Não invente dados que não estão lá. Se algo estiver ausente, diga o que medir.`;

function montaPromptUsuario(resumo) {
  return "Analise este recorte do painel (JSON):\n\n```json\n" +
    JSON.stringify(resumo, null, 2) +
    "\n```\n\nGere os insights conforme as seções pedidas.";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Hub-Token",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || "*";
    const cors = corsHeaders(allowed);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

    // Token compartilhado (eleva a barra contra abuso; não é segredo forte)
    if (env.HUB_TOKEN) {
      const tok = request.headers.get("X-Hub-Token");
      if (tok !== env.HUB_TOKEN) return json({ error: "unauthorized" }, 401, cors);
    }

    if (!env.OPENAI_API_KEY) return json({ error: "missing_api_key" }, 500, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "invalid_json" }, 400, cors); }

    const resumo = body && body.resumo ? body.resumo : null;
    if (!resumo) return json({ error: "missing_resumo" }, 400, cors);

    let resp;
    try {
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODELO,
          temperature: 0.5,
          max_tokens: MAX_TOKENS,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: montaPromptUsuario(resumo) },
          ],
        }),
      });
    } catch (e) {
      return json({ error: "fetch_failed", detail: String(e) }, 502, cors);
    }

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: "openai_error", status: resp.status, detail }, 502, cors);
    }

    const data = await resp.json();
    const insight = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : "";
    return json({ insight, modelo: MODELO }, 200, cors);
  },
};
