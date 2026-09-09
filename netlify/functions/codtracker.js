// ============================================================
// REINO 127 - COD TRACKER BRIDGE
// Primera prueba con Browserless
// ============================================================

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };

  // ----------------------------------------------------------
  // CORS preflight
  // ----------------------------------------------------------
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  // ----------------------------------------------------------
  // Browserless token
  // ----------------------------------------------------------
  const token = process.env.BROWSERLESS_TOKEN;

  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "BROWSERLESS_TOKEN no está configurado en Netlify."
      })
    };
  }

  // ----------------------------------------------------------
  // Parámetros
  // ----------------------------------------------------------
  const params = event.queryStringParameters || {};

  const query = String(params.q || "").trim();
  const mode = String(params.mode || "auto").trim();

  if (!query) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Falta el parámetro q."
      })
    };
  }

  // Evitar consultas excesivamente largas
  if (query.length > 100) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "La búsqueda es demasiado larga."
      })
    };
  }

  // ----------------------------------------------------------
  // Código que Browserless ejecutará dentro de Chrome
  // ----------------------------------------------------------
  const browserCode = `
export default async ({ page, context }) => {

  const q = context.query;

  const target =
    "https://cod-tracker.com/lord?q=" +
    encodeURIComponent(q);

  let navigationError = null;

  try {
    await page.goto(target, {
      waitUntil: "networkidle2",
      timeout: 30000
    });
  } catch (err) {
    navigationError = err && err.message
      ? err.message
      : String(err);
  }

  // Dar tiempo a que COD Tracker termine de ejecutar
  // su JavaScript y renderizar los resultados.
  await new Promise(resolve => setTimeout(resolve, 5000));

  const result = await page.evaluate(() => {

    const clean = (value) => {
      if (!value) return "";
      return String(value)
        .replace(/\\\\u00a0/g, " ")
        .replace(/\\\\s+/g, " ")
        .trim();
    };

    const bodyText = document.body
      ? document.body.innerText || ""
      : "";

    const title = document.title || "";

    const tables = Array.from(
      document.querySelectorAll("table")
    ).map((table) => {

      const rows = Array.from(
        table.querySelectorAll("tr")
      ).map((row) => {

        return Array.from(
          row.querySelectorAll("th, td")
        ).map(cell => clean(cell.innerText));

      });

      return rows;
    });

    const links = Array.from(
      document.querySelectorAll("a[href]")
    )
      .slice(0, 100)
      .map(a => ({
        text: clean(a.innerText),
        href: a.href
      }));

    const headings = Array.from(
      document.querySelectorAll("h1, h2, h3, h4")
    ).map(h => clean(h.innerText));

    return {
      title,
      url: location.href,
      bodyText,
      headings,
      tables,
      links
    };
  });

  return {
    data: {
      query: q,
      target,
      navigationError,
      ...result
    },
    type: "application/json"
  };
};
`;

  // ----------------------------------------------------------
  // Llamada a Browserless
  // ----------------------------------------------------------
  const browserlessUrl =
    "https://production-sfo.browserless.io/function?token=" +
    encodeURIComponent(token);

  try {

    const response = await fetch(browserlessUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: browserCode,
        context: {
          query
        }
      })
    });

    const responseText = await response.text();

    let browserlessData;

    try {
      browserlessData = JSON.parse(responseText);
    } catch {
      browserlessData = {
        raw: responseText
      };
    }

    if (!response.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "Browserless devolvió un error.",
          browserlessStatus: response.status,
          browserless: browserlessData
        })
      };
    }

    // --------------------------------------------------------
    // Devolvemos los datos de la prueba a REINO 127
    // --------------------------------------------------------
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        source: "COD Tracker",
        mode,
        query,
        result: browserlessData.data || browserlessData
      })
    };

  } catch (error) {

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Error comunicando con Browserless.",
        details: error && error.message
          ? error.message
          : String(error)
      })
    };
  }
};
