// REINO 127 HUB -> COD Tracker via Browserless
// El token de Browserless se guarda SOLO en Netlify como BROWSERLESS_TOKEN.
// No se copian tokens/cookies de COD Tracker y no se alteran sus controles de acceso.

exports.handler = async function(event) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  };

  try {
    const q = String(event.queryStringParameters?.q || '').trim();
    const mode = String(event.queryStringParameters?.mode || 'auto').toLowerCase();
    const debug = String(event.queryStringParameters?.debug || '') === '1';

    if (!q) return resp(400, { ok:false, error:'Falta q' });
    if (q.length > 80) return resp(400, { ok:false, error:'Consulta demasiado larga' });

    const browserlessToken = process.env.BROWSERLESS_TOKEN;
    if (!browserlessToken) {
      return resp(500, { ok:false, error:'Falta configurar BROWSERLESS_TOKEN en Netlify.' });
    }

    const code = `
      export default async ({ page, context }) => {
        const q = String(context.q || '').trim();
        const mode = String(context.mode || 'auto').toLowerCase();
        const url = 'https://cod-tracker.com/lord?q=' + encodeURIComponent(q);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Dejamos que COD Tracker termine su propio JS y su propia carga de datos.
        await new Promise(r => setTimeout(r, 1800));

        // Espera corta adicional si la página sigue actualizando el resultado.
        try {
          await page.waitForFunction(
            (needle) => {
              const t = document.body?.innerText || '';
              return t.includes(needle) || /Tìm Lãnh Chúa|Thông Tin Lãnh Chúa/i.test(t);
            },
            { timeout: 7000 },
            q
          );
        } catch (_) {}

        const result = await page.evaluate((needle, searchMode) => {
          const clean = s => String(s ?? '').replace(/\\s+/g, ' ').trim();
          const bodyText = clean(document.body?.innerText || '');

          const textNodes = [...document.querySelectorAll('body *')]
            .filter(el => el.children.length === 0)
            .map(el => clean(el.textContent))
            .filter(Boolean);

          const links = [...document.querySelectorAll('a[href]')]
            .map(a => ({ text: clean(a.textContent), href: a.href }))
            .filter(x => x.text || x.href);

          const title = document.title || '';

          return {
            url: location.href,
            title,
            bodyText,
            textNodes: textNodes.slice(0, 800),
            links: links.slice(0, 300),
            query: needle,
            mode: searchMode
          };
        }, q, mode);

        return { data: result, type: 'application/json' };
      };
    `;

    const browserlessUrl =
      'https://production-sfo.browserless.io/function?token=' +
      encodeURIComponent(browserlessToken);

    const r = await fetch(browserlessUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/javascript' },
      body: code
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); }
    catch (_) { data = null; }

    if (!r.ok) {
      console.error('Browserless HTTP', r.status, raw.slice(0, 1000));
      return resp(502, { ok:false, error:`Browserless HTTP ${r.status}` });
    }

    if (!data) {
      return resp(502, { ok:false, error:'Browserless devolvió una respuesta no válida.' });
    }

    const player = normalizeTrackerResult(data, q);

    // Durante la puesta en marcha ?debug=1 permite inspeccionar el resultado bruto.
    // No se usa por defecto para mantener la respuesta limpia.
    if (debug) {
      return resp(200, { ok:true, source:'COD Tracker', mode, query:q, player, debug:data });
    }

    if (!player || !player.id) {
      return resp(404, { ok:true, source:'COD Tracker', mode, query:q, player:null });
    }

    return resp(200, { ok:true, source:'COD Tracker', mode, query:q, player });
  } catch (err) {
    console.error('COD Tracker Browserless error:', err);
    return resp(500, { ok:false, error:'Error interno de consulta' });
  }
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] != null) return m[1].trim();
  }
  return '';
}

function numberFromText(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  // COD Tracker muestra separadores de miles con puntos/comas.
  const compact = s.replace(/[^0-9.\-]/g, '');
  if (!compact) return 0;
  const parts = compact.split('.');
  if (parts.length > 1 && parts.every(p => /^\d+$/.test(p)) && parts.slice(1).every(p => p.length === 3)) {
    return Number(parts.join('')) || 0;
  }
  return Number(compact.replace(/,/g, '')) || 0;
}

function normalizeTrackerResult(data, q) {
  const text = String(data?.bodyText || '');
  if (!text) return null;

  // Extraemos primero los identificadores que aparecen de forma estable en la página.
  const id = firstMatch(text, [
    /\bID\s*[:#]?\s*(\d{5,15})\b/i,
    /\bID\s+n?\s*(\d{5,15})\b/i,
    /\bLord\s*ID\s*[:#]?\s*(\d{5,15})\b/i
  ]);

  const server = firstMatch(text, [
    /\bServer\s*[:#]?\s*(\d{1,5})\b/i,
    /\bSv\s*[:#]?\s*(\d{1,5})\b/i,
    /\bserver\s+n?\s*(\d{1,5})\b/i,
    /\bS(\d{2,5})\b/
  ]);

  // La ficha de COD Tracker coloca el nombre cerca del encabezado del perfil.
  let name = firstMatch(text, [
    /Thông Tin Lãnh Chúa\s+([^•\n]{2,80})/i,
    /Tên Lãnh Chúa\s+([^•\n]{2,80})/i,
    /Lãnh Chúa\s+([^•\n]{2,80})/i
  ]);
  name = name.replace(/^[:\-]+\s*/, '').trim();

  const alliance = firstMatch(text, [
    /Liên Minh\s*[:#]?\s*([^•\n]{1,80})/i,
    /Alliance\s*[:#]?\s*([^•\n]{1,80})/i
  ]);

  const power = numberFromText(firstMatch(text, [
    /Lực Chiến\s+n?\s*([0-9.,]+)/i,
    /Power\s*[:#]?\s*([0-9.,]+)/i
  ]));

  const powerMax = numberFromText(firstMatch(text, [
    /Lực Chiến Max\s+n?\s*([0-9.,]+)/i,
    /Max(?:imum)? Power\s*[:#]?\s*([0-9.,]+)/i
  ]));

  const merit = numberFromText(firstMatch(text, [
    /Công Trạng\s+n?\s*([0-9.,]+)/i,
    /Merit(?:s)?\s*[:#]?\s*([0-9.,]+)/i
  ]));

  const kill = numberFromText(firstMatch(text, [
    /Tiêu Diệt\s+n?\s*([0-9.,]+)/i,
    /Kills?\s*[:#]?\s*([0-9.,]+)/i
  ]));

  const dead = numberFromText(firstMatch(text, [
    /Tử Vong\s+n?\s*([0-9.,]+)/i,
    /Dead\s*[:#]?\s*([0-9.,]+)/i,
    /Deaths?\s*[:#]?\s*([0-9.,]+)/i
  ]));

  const heal = numberFromText(firstMatch(text, [
    /Hồi Phục\s+n?\s*([0-9.,]+)/i,
    /Healed?\s*[:#]?\s*([0-9.,]+)/i
  ]));

  const victory = numberFromText(firstMatch(text, [
    /Chiến Thắng\s+n?\s*([0-9.,]+)/i,
    /Victories?\s*[:#]?\s*([0-9.,]+)/i
  ]));

  const failure = numberFromText(firstMatch(text, [
    /Thất Bại\s+n?\s*([0-9.,]+)/i,
    /Failures?\s*[:#]?\s*([0-9.,]+)/i
  ]));

  // Si todavía no tenemos ID, pero la consulta era numérica, usamos la propia consulta.
  const finalId = id || (/^\d+$/.test(q) ? q : '');
  if (!finalId && !name) return null;

  return {
    id: finalId,
    name,
    server,
    alliance,
    power,
    powerMax,
    merit,
    dead,
    heal,
    kill,
    victory,
    failure,
    source: 'COD Tracker',
    sourceUrl: data?.url || ''
  };
}
