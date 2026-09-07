// REINO 127 HUB -> COD Tracker
// Esta función mantiene cualquier app-token fuera del navegador.
// No contiene tokens, cookies ni credenciales privadas.
exports.handler = async function(event) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  };

  try {
    const q = String(event.queryStringParameters?.q || '').trim();
    const mode = String(event.queryStringParameters?.mode || 'auto').toLowerCase();

    if (!q) {
      return { statusCode: 400, headers, body: JSON.stringify({ok:false,error:'Falta q'}) };
    }
    if (q.length > 80) {
      return { statusCode: 400, headers, body: JSON.stringify({ok:false,error:'Consulta demasiado larga'}) };
    }

    // 1) Obtener el token de aplicación de la propia fuente.
    // No se devuelve al cliente.
    const tokenRes = await fetch('https://cod-tracker.com/api/token', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'REINO127-HUB/1.0'
      }
    });
    if (!tokenRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ok:false,error:`COD Tracker token HTTP ${tokenRes.status}`}) };
    }
    const tokenData = await tokenRes.json();
    const appToken = tokenData?.token || tokenData?.appToken || tokenData?.accessToken;
    if (!appToken) {
      return { statusCode: 502, headers, body: JSON.stringify({ok:false,error:'COD Tracker no devolvió token de aplicación'}) };
    }

    // 2) La búsqueda global usa latest?sv=v3. La respuesta contiene
    // snapshots organizados por servidor/fecha. Buscamos sin alterar los datos.
    const latestRes = await fetch('https://cod-tracker.com/api/snapshot/latest?sv=v3', {
      headers: {
        'Accept': 'application/json',
        'X-App-Token': appToken,
        'User-Agent': 'REINO127-HUB/1.0'
      }
    });
    if (!latestRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ok:false,error:`COD Tracker latest HTTP ${latestRes.status}`}) };
    }

    const latest = await latestRes.json();

    const target = q.toLowerCase();
    let found = null;
    let foundServer = null;

    function visit(node, serverHint) {
      if (found || node == null) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, serverHint);
        return;
      }
      if (typeof node !== 'object') return;

      const id = node.id != null ? String(node.id) : '';
      const name = node.name != null ? String(node.name) : '';
      const matches = mode === 'id'
        ? id === q
        : mode === 'name'
          ? name.toLowerCase().includes(target)
          : (id === q || name.toLowerCase().includes(target));

      if (matches && id) {
        found = node;
        foundServer = serverHint ?? node.server ?? node.reino ?? null;
        return;
      }

      for (const [key, value] of Object.entries(node)) {
        // latest usa claves numéricas para servidores.
        const nextServer = /^\d+$/.test(key) ? key : serverHint;
        visit(value, nextServer);
        if (found) return;
      }
    }

    visit(latest, null);

    if (!found) {
      return { statusCode: 404, headers, body: JSON.stringify({ok:true,player:null}) };
    }

    // Solo devolvemos campos útiles para el HUB.
    const player = {
      id: found.id != null ? String(found.id) : '',
      name: found.name ?? '',
      server: foundServer != null ? String(foundServer) : '',
      alliance: found.alliance ?? '',
      power: Number(found.power) || 0,
      powerMax: Number(found.powerMax) || 0,
      merit: Number(found.merit) || 0,
      dead: Number(found.dead) || 0,
      heal: Number(found.heal) || 0,
      kill: Number(found.kill) || 0,
      victory: Number(found.victory) || 0,
      failure: Number(found.failure) || 0,
      grade: found.grade ?? null
    };

    return { statusCode: 200, headers, body: JSON.stringify({ok:true,player}) };
  } catch (err) {
    console.error('COD Tracker function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ok:false,error:'Error interno de consulta'})
    };
  }
};
