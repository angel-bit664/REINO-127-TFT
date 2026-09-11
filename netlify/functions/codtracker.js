// ============================================================
// REINO 127 HUB -> COD TRACKER VIA BROWSERLESS
// ============================================================
//
// El token de Browserless se guarda SOLO en Netlify:
//
// BROWSERLESS_TOKEN
//
// No se copian tokens, cookies ni credenciales de COD Tracker.
// La consulta se realiza mediante Browserless y se procesa
// únicamente la información pública obtenida de la página.
//
// ============================================================


exports.handler = async function(event) {

  try {

    // ========================================================
    // 1. PARAMETROS
    // ========================================================

    const q = String(
      event.queryStringParameters?.q || ''
    ).trim();

    const mode = String(
      event.queryStringParameters?.mode || 'auto'
    ).toLowerCase();

    const debug =
      String(
        event.queryStringParameters?.debug || ''
      ) === '1';


    // ========================================================
    // VALIDACIONES
    // ========================================================

    if (!q) {

      return resp(400, {
        ok: false,
        error: 'Falta q'
      });

    }


    if (q.length > 80) {

      return resp(400, {
        ok: false,
        error: 'Consulta demasiado larga'
      });

    }


    // ========================================================
    // 2. TOKEN
    // ========================================================

    const browserlessToken =
      process.env.BROWSERLESS_TOKEN;


    if (!browserlessToken) {

      return resp(500, {
        ok: false,
        error:
          'Falta configurar BROWSERLESS_TOKEN en Netlify.'
      });

    }


    // ========================================================
    // 3. CODIGO BROWSERLESS
    // ========================================================

    const code = `

      export default async ({ page, context }) => {

        const q =
          String(context.q || '').trim();

        const mode =
          String(context.mode || 'auto').toLowerCase();


        const url =
          'https://cod-tracker.com/lord?q=' +
          encodeURIComponent(q);


        // ====================================================
        // CARGAR COD TRACKER
        // ====================================================

        await page.goto(url, {

          waitUntil: 'networkidle2',

          timeout: 30000

        });


        // ====================================================
        // ESPERAR A QUE COD TRACKER TERMINE SU JS
        // ====================================================

        await new Promise(resolve =>
          setTimeout(resolve, 2200)
        );


        // ====================================================
        // ESPERA ADICIONAL
        // ====================================================

        try {

          await page.waitForFunction(

            (needle) => {

              const text =
                document.body?.innerText || '';

              return (

                text.includes(needle) ||

                /Tìm Lãnh Chúa/i.test(text) ||

                /Thông Tin Lãnh Chúa/i.test(text) ||

                /Lord Information/i.test(text) ||

                /Player Information/i.test(text)

              );

            },

            {
              timeout: 8000
            },

            q

          );

        } catch (_) {}


        // ====================================================
        // EXTRAER INFORMACION DE LA PAGINA
        // ====================================================

        const result =
          await page.evaluate(

            (needle, searchMode) => {

              const clean = value =>
                String(value ?? '')
                  .replace(/\\s+/g, ' ')
                  .trim();


              // ------------------------------------------------
              // TEXTO COMPLETO
              // ------------------------------------------------

              const bodyText =
                clean(
                  document.body?.innerText || ''
                );


              // ------------------------------------------------
              // NODOS DE TEXTO
              // ------------------------------------------------

              const textNodes = [

                ...document.querySelectorAll(
                  'body *'
                )

              ]

                .filter(el =>
                  el.children.length === 0
                )

                .map(el =>
                  clean(el.textContent)
                )

                .filter(Boolean);


              // ------------------------------------------------
              // LINKS
              // ------------------------------------------------

              const links = [

                ...document.querySelectorAll(
                  'a[href]'
                )

              ]

                .map(a => ({

                  text:
                    clean(a.textContent),

                  href:
                    a.href

                }))

                .filter(x =>
                  x.text || x.href
                );


              // ------------------------------------------------
              // TITLE
              // ------------------------------------------------

              const title =
                document.title || '';


              return {

                url:
                  location.href,

                title,

                bodyText,

                textNodes:
                  textNodes.slice(0, 1500),

                links:
                  links.slice(0, 300),

                query:
                  needle,

                mode:
                  searchMode

              };

            },

            q,
            mode

          );


        return {

          data:
            result,

          type:
            'application/json'

        };

      };

    `;


    // ========================================================
    // 4. URL BROWSERLESS
    // ========================================================

    const browserlessUrl =
      'https://production-sfo.browserless.io/function?token=' +
      encodeURIComponent(browserlessToken);


    // ========================================================
    // 5. CONSULTA A BROWSERLESS
    // ========================================================

    const r =
      await fetch(

        browserlessUrl,

        {

          method:
            'POST',

          headers: {

            'content-type':
              'application/javascript'

          },

          body:
            code

        }

      );


    const raw =
      await r.text();


    // ========================================================
    // 6. PARSEAR RESPUESTA
    // ========================================================

    let data = null;


    try {

      data =
        JSON.parse(raw);

    } catch (_) {

      data = null;

    }


    // ========================================================
    // ERROR HTTP BROWSERLESS
    // ========================================================

    if (!r.ok) {

      console.error(
        'Browserless HTTP:',
        r.status,
        raw.slice(0, 2000)
      );


      return resp(502, {

        ok: false,

        error:
          `Browserless HTTP ${r.status}`

      });

    }


    if (!data) {

      console.error(
        'Browserless respuesta invalida:',
        raw.slice(0, 2000)
      );


      return resp(502, {

        ok: false,

        error:
          'Browserless devolvió una respuesta no válida.'

      });

    }


    // ========================================================
    // 7. NORMALIZAR RESULTADO
    // ========================================================

    const player =
      normalizeTrackerResult(
        data,
        q
      );


    // ========================================================
    // 8. DEBUG
    // ========================================================

    if (debug) {

      return resp(200, {

        ok: true,

        source:
          'COD Tracker',

        mode,

        query:
          q,

        player,

        debug: {

          responseKeys:
            Object.keys(data || {}),

          rawData:
            data

        }

      });

    }


    // ========================================================
    // 9. NO ENCONTRADO
    // ========================================================

    if (!player) {

      return resp(200, {

        ok: false,

        source:
          'COD Tracker',

        mode,

        query:
          q,

        player: null,

        error:
          'No se pudieron extraer los datos del jugador.'

      });

    }


    // ========================================================
    // 10. RESPUESTA FINAL LIMPIA
    // ========================================================

    return resp(200, {

      ok: true,

      source:
        'COD Tracker',

      mode,

      query:
        q,

      player

    });


  } catch (err) {

    console.error(
      'COD Tracker Browserless error:',
      err
    );


    return resp(500, {

      ok: false,

      error:
        'Error interno de consulta'

    });

  }

};


// ============================================================
// RESPUESTA JSON
// ============================================================

function resp(statusCode, body) {

  return {

    statusCode,

    headers: {

      'content-type':
        'application/json; charset=utf-8',

      'cache-control':
        'no-store'

    },

    body:
      JSON.stringify(body)

  };

}


// ============================================================
// OBTENER TEXTO DE CUALQUIER ESTRUCTURA BROWSERLESS
// ============================================================
//
// Esto evita depender de que Browserless entregue:
//
// data.bodyText
//
// o:
//
// data.data.bodyText
//
// o:
//
// data.result.bodyText
//
// ============================================================

function extractPageData(data) {

  const candidates = [

    data,

    data?.data,

    data?.result,

    data?.data?.data,

    data?.data?.result,

    data?.result?.data,

    data?.result?.result

  ];


  for (const item of candidates) {

    if (
      item &&
      typeof item === 'object'
    ) {

      const bodyText =
        String(
          item.bodyText || ''
        ).trim();


      const textNodes =
        Array.isArray(item.textNodes)
          ? item.textNodes
          : [];


      if (
        bodyText ||
        textNodes.length
      ) {

        return {

          bodyText,

          textNodes,

          url:
            item.url || '',

          title:
            item.title || ''

        };

      }

    }

  }


  return {

    bodyText: '',

    textNodes: [],

    url: '',

    title: ''

  };

}


// ============================================================
// BUSCAR PRIMER MATCH
// ============================================================

function firstMatch(text, patterns) {

  for (const re of patterns) {

    const m =
      text.match(re);


    if (
      m &&
      m[1] != null
    ) {

      return String(
        m[1]
      ).trim();

    }

  }


  return '';

}


// ============================================================
// LIMPIAR TEXTO
// ============================================================

function cleanText(value) {

  return String(
    value ?? ''
  )

    .replace(/\s+/g, ' ')

    .replace(
      /^[\s:|\-]+/,
      ''
    )

    .replace(
      /[\s|]+$/,
      ''
    )

    .trim();

}


// ============================================================
// NUMEROS
// ============================================================

function numberFromText(value) {

  if (
    value == null
  ) {

    return 0;

  }


  let s =
    String(value)
      .trim();


  if (!s)
    return 0;


  // Eliminar palabras y símbolos.
  s =
    s.replace(
      /[^0-9.,\-]/g,
      ''
    );


  if (!s)
    return 0;


  // ----------------------------------------------------------
  // 858.695.123
  // ----------------------------------------------------------

  if (
    /^\d{1,3}(?:\.\d{3})+$/.test(s)
  ) {

    return Number(
      s.replace(/\./g, '')
    ) || 0;

  }


  // ----------------------------------------------------------
  // 858,695,123
  // ----------------------------------------------------------

  if (
    /^\d{1,3}(?:,\d{3})+$/.test(s)
  ) {

    return Number(
      s.replace(/,/g, '')
    ) || 0;

  }


  // ----------------------------------------------------------
  // Decimal real
  // ----------------------------------------------------------

  if (
    /^\d+\.\d+$/.test(s)
  ) {

    return Number(s) || 0;

  }


  if (
    /^\d+,\d+$/.test(s)
  ) {

    return Number(
      s.replace(',', '.')
    ) || 0;

  }


  // ----------------------------------------------------------
  // Ultimo intento
  // ----------------------------------------------------------

  const digits =
    s.replace(
      /[^0-9\-]/g,
      ''
    );


  return Number(
    digits
  ) || 0;

}


// ============================================================
// BUSCAR ESTADISTICA CERCA DE UNA ETIQUETA
// ============================================================

function valueNearLabel(
  text,
  labels
) {

  for (
    const label of labels
  ) {

    const escaped =
      label.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );


    const patterns = [

      new RegExp(
        escaped +
        '\\s*[:#]?\\s*([0-9][0-9.,]*)',
        'i'
      ),

      new RegExp(
        escaped +
        '\\s+n?\\s*([0-9][0-9.,]*)',
        'i'
      )

    ];


    const result =
      firstMatch(
        text,
        patterns
      );


    if (result)
      return result;

  }


  return '';

}


// ============================================================
// NORMALIZAR RESULTADO
// ============================================================

function normalizeTrackerResult(
  data,
  q
) {

  const page =
    extractPageData(data);


  // ----------------------------------------------------------
  // COMBINAR BODY + TEXT NODES
  // ----------------------------------------------------------

  const nodeText =
    page.textNodes.join(' ');


  const text =
    cleanText(
      [
        page.bodyText,
        nodeText
      ]
        .filter(Boolean)
        .join(' ')
    );


  if (!text) {

    console.error(
      'COD Tracker: página sin texto extraíble.'
    );

    return null;

  }


  // ==========================================================
  // ID
  // ==========================================================

  const id =
    firstMatch(

      text,

      [

        /\bID\s*[:#]?\s*(\d{5,15})\b/i,

        /\bID\s+n?\s*(\d{5,15})\b/i,

        /\bLord\s*ID\s*[:#]?\s*(\d{5,15})\b/i,

        /\bPlayer\s*ID\s*[:#]?\s*(\d{5,15})\b/i

      ]

    );


  // ==========================================================
  // SERVIDOR / REINO
  // ==========================================================

  let server =
    firstMatch(

      text,

      [

        /\bServer\s*[:#]?\s*S?(\d{1,5})\b/i,

        /\bSv\s*[:#]?\s*S?(\d{1,5})\b/i,

        /\bserver\s+n?\s*S?(\d{1,5})\b/i,

        /\bKingdom\s*[:#]?\s*S?(\d{1,5})\b/i,

        /\bS(\d{2,5})\b/i

      ]

    );


  if (
    server &&
    !server.startsWith('S')
  ) {

    server =
      'S' + server;

  }


  // ==========================================================
  // NOMBRE
  // ==========================================================

  let name =
    firstMatch(

      text,

      [

        /Thông Tin Lãnh Chúa\s+([^•|]{2,80})/i,

        /Tên Lãnh Chúa\s+([^•|]{2,80})/i,

        /Lãnh Chúa\s+([^•|]{2,80})/i,

        /Lord Name\s*[:#]?\s*([^•|]{2,80})/i,

        /Player Name\s*[:#]?\s*([^•|]{2,80})/i,

        /Name\s*[:#]?\s*([^•|]{2,80})/i

      ]

    );


  name =
    cleanText(name);


  // ----------------------------------------------------------
  // Evitar que el nombre capture demasiada información
  // ----------------------------------------------------------

  name =
    name
      .split(
        /\b(?:ID|Server|Alliance|Liên Minh|Power|Lực Chiến)\b/i
      )[0]
      .trim();


  // ==========================================================
  // ALIANZA
  // ==========================================================

  const alliance =
    cleanText(

      firstMatch(

        text,

        [

          /Liên Minh\s*[:#]?\s*([^•|]{1,80})/i,

          /Alliance\s*[:#]?\s*([^•|]{1,80})/i,

          /Alliance\s+([^•|]{1,80})/i,

          /Guild\s*[:#]?\s*([^•|]{1,80})/i

        ]

      )

    );


  // ==========================================================
  // PODER
  // ==========================================================

  const power =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Lực Chiến',

          'Power'

        ]

      )

    );


  // ==========================================================
  // PODER MAXIMO
  // ==========================================================

  const powerMax =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Lực Chiến Max',

          'Max Power',

          'Maximum Power'

        ]

      )

    );


  // ==========================================================
  // CONSTRUCCION
  // ==========================================================

  const powerConstruction =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Lực Chiến Xây Dựng',

          'Poder de Construcción',

          'Construction Power',

          'Building Power'

        ]

      )

    );


  // ==========================================================
  // INVESTIGACION
  // ==========================================================

  const powerResearch =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Lực Chiến Nghiên Cứu',

          'Poder de Investigación',

          'Research Power',

          'Technology Power'

        ]

      )

    );


  // ==========================================================
  // TROPAS
  // ==========================================================

  const powerTroops =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Lực Chiến Quân Đội',

          'Poder de Tropas',

          'Troop Power',

          'Army Power'

        ]

      )

    );


  // ==========================================================
  // HEROES
  // ==========================================================

  const powerHeroes =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Lực Chiến Anh Hùng',

          'Poder de Héroes',

          'Hero Power',

          'Heroes Power'

        ]

      )

    );


  // ==========================================================
  // MERITOS
  // ==========================================================

  const merit =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Công Trạng',

          'Merit',

          'Merits'

        ]

      )

    );


  // ==========================================================
  // KILLS
  // ==========================================================

  const kill =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Tiêu Diệt',

          'Kills',

          'Kill'

        ]

      )

    );


  // ==========================================================
  // MUERTES / DEAD
  // ==========================================================

  const dead =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Tử Vong',

          'Dead',

          'Deaths',

          'Death'

        ]

      )

    );


  // ==========================================================
  // CURACION
  // ==========================================================

  const heal =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Hồi Phục',

          'Healed',

          'Healing',

          'Heal'

        ]

      )

    );


  // ==========================================================
  // VICTORIAS
  // ==========================================================

  const victory =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Chiến Thắng',

          'Victories',

          'Victory'

        ]

      )

    );


  // ==========================================================
  // DERROTAS
  // ==========================================================

  const failure =
    numberFromText(

      valueNearLabel(

        text,

        [

          'Thất Bại',

          'Failures',

          'Failure',

          'Defeats',

          'Defeat'

        ]

      )

    );


  // ==========================================================
  // ID FINAL
  // ==========================================================

  const finalId =
    id ||
    (
      /^\d+$/.test(q)
        ? q
        : ''
    );


  // ==========================================================
  // VALIDACION
  // ==========================================================

  if (
    !finalId &&
    !name
  ) {

    console.error(
      'COD Tracker: no se encontró ID ni nombre.',
      {
        query: q,
        textPreview:
          text.slice(0, 1000)
      }
    );

    return null;

  }


  // ==========================================================
  // OBJETO FINAL
  // ==========================================================

  return {

    // --------------------------------------------------------
    // IDENTIDAD
    // --------------------------------------------------------

    id:
      finalId,

    name:
      name,

    server:
      server,

    alliance:
      alliance,


    // --------------------------------------------------------
    // PODER
    // --------------------------------------------------------

    power:
      power,

    powerMax:
      powerMax,


    powerBreakdown: {

      construction:
        powerConstruction,

      research:
        powerResearch,

      troops:
        powerTroops,

      heroes:
        powerHeroes

    },


    // --------------------------------------------------------
    // ESTADISTICAS
    // --------------------------------------------------------

    merit:
      merit,

    dead:
      dead,

    heal:
      heal,

    kill:
      kill,

    victory:
      victory,

    failure:
      failure,


    // --------------------------------------------------------
    // FUENTE
    // --------------------------------------------------------

    source:
      'COD Tracker',

    sourceUrl:
      page.url || ''

  };

}
