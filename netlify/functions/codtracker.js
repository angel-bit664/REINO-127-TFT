// ============================================================
// REINO 127 - COD TRACKER + BROWSERLESS
// Prueba 2: interactuar con el buscador de COD Tracker
// ============================================================

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  const token = process.env.BROWSERLESS_TOKEN;

  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "BROWSERLESS_TOKEN no está configurado."
      })
    };
  }

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

  if (query.length > 100) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Consulta demasiado larga."
      })
    };
  }

  // ==========================================================
  // Código que ejecutará Browserless dentro de Chrome
  // ==========================================================

  const browserCode = `
export default async ({ page, context }) => {

  const q = context.query;

  const clean = (value) => {
    if (!value) return "";

    return String(value)
      .replace(/\\\\u00a0/g, " ")
      .replace(/\\\\s+/g, " ")
      .trim();
  };

  // ----------------------------------------------------------
  // 1. Abrir la página pública de búsqueda
  // ----------------------------------------------------------

  await page.goto(
    "https://cod-tracker.com/lord",
    {
      waitUntil: "networkidle2",
      timeout: 30000
    }
  );

  await new Promise(resolve => setTimeout(resolve, 3000));

  // ----------------------------------------------------------
  // 2. Inspeccionar los campos disponibles
  // ----------------------------------------------------------

  const inputsBefore = await page.evaluate(() => {

    return Array.from(
      document.querySelectorAll("input")
    ).map((input, index) => ({
      index,
      type: input.type || "",
      name: input.name || "",
      id: input.id || "",
      placeholder: input.placeholder || "",
      aria: input.getAttribute("aria-label") || "",
      value: input.value || ""
    }));

  });

  // ----------------------------------------------------------
  // 3. Buscar el input adecuado
  // ----------------------------------------------------------

  const inputHandle = await page.evaluateHandle(() => {

    const inputs = Array.from(
      document.querySelectorAll("input")
    );

    const score = (input) => {

      const text = [
        input.type,
        input.name,
        input.id,
        input.placeholder,
        input.getAttribute("aria-label")
      ]
        .join(" ")
        .toLowerCase();

      let points = 0;

      if (
        input.type === "search"
      ) points += 10;

      if (
        text.includes("search") ||
        text.includes("buscar") ||
        text.includes("name") ||
        text.includes("lord") ||
        text.includes("id")
      ) {
        points += 5;
      }

      if (
        input.placeholder
      ) {
        points += 2;
      }

      return points;
    };

    inputs.sort(
      (a, b) => score(b) - score(a)
    );

    return inputs[0] || null;

  });

  const input = inputHandle.asElement();

  if (!input) {

    return {
      data: {
        ok: false,
        stage: "find-input",
        query: q,
        inputsBefore,
        bodyText: document.body
          ? document.body.innerText || ""
          : ""
      },
      type: "application/json"
    };

  }

  // ----------------------------------------------------------
  // 4. Escribir la consulta
  // ----------------------------------------------------------

  await input.click({
    clickCount: 3
  });

  await input.press("Control+A");

  await input.type(q, {
    delay: 40
  });

  // ----------------------------------------------------------
  // 5. Intentar enviar mediante Enter
  // ----------------------------------------------------------

  await input.press("Enter");

  // ----------------------------------------------------------
  // 6. Esperar que COD Tracker procese la búsqueda
  // ----------------------------------------------------------

  await new Promise(resolve => setTimeout(resolve, 5000));

  // ----------------------------------------------------------
  // 7. Si Enter no produjo navegación/cambio,
  //    buscar botones relacionados
  // ----------------------------------------------------------

  const afterEnter = await page.evaluate(() => ({
    url: location.href,
    bodyText: document.body
      ? document.body.innerText || ""
      : ""
  }));

  const stillLooksLikeSearchPage =
    !afterEnter.bodyText ||
    afterEnter.bodyText.length < 300;

  if (stillLooksLikeSearchPage) {

    const buttons = await page.$$("button");

    for (const button of buttons) {

      const info = await button.evaluate(btn => ({
        text: btn.innerText || "",
        aria: btn.getAttribute("aria-label") || "",
        title: btn.getAttribute("title") || ""
      }));

      const buttonText = (
        info.text + " " +
        info.aria + " " +
        info.title
      ).toLowerCase();

      if (
        buttonText.includes("search") ||
        buttonText.includes("buscar") ||
        buttonText.includes("find") ||
        buttonText.includes("tìm")
      ) {

        try {
          await button.click();
          await new Promise(
            resolve => setTimeout(resolve, 5000)
          );
        } catch (e) {}

        break;
      }
    }
  }

  // ----------------------------------------------------------
  // 8. Extraer el resultado final
  // ----------------------------------------------------------

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

    const headings = Array.from(
      document.querySelectorAll(
        "h1,h2,h3,h4,h5"
      )
    ).map(
      el => clean(el.innerText)
    );

    const inputs = Array.from(
      document.querySelectorAll("input")
    ).map(
      (input, index) => ({
        index,
        type: input.type || "",
        name: input.name || "",
        id: input.id || "",
        placeholder: input.placeholder || "",
        value: input.value || ""
      })
    );

    const buttons = Array.from(
      document.querySelectorAll("button")
    ).map(
      (button, index) => ({
        index,
        text: clean(button.innerText),
        aria:
          button.getAttribute("aria-label") || "",
        title:
          button.getAttribute("title") || ""
      })
    );

    const links = Array.from(
      document.querySelectorAll("a[href]")
    )
      .slice(0, 150)
      .map(
        a => ({
          text: clean(a.innerText),
          href: a.href
        })
      );

    const tables = Array.from(
      document.querySelectorAll("table")
    ).map(table =>
      Array.from(
        table.querySelectorAll("tr")
      ).map(row =>
        Array.from(
          row.querySelectorAll("th,td")
        ).map(
          cell => clean(cell.innerText)
        )
      )
    );

    return {
      url: location.href,
      title: document.title || "",
      bodyText,
      headings,
      inputs,
      buttons,
      links,
      tables
    };

  });

  return {
    data: {
      ok: true,
      query: q,
      target:
        "https://cod-tracker.com/lord",
      inputsBefore,
      result
    },
    type: "application/json"
  };

};
`;

  // ==========================================================
  // Browserless
  // ==========================================================

  const browserlessUrl =
    "https://production-sfo.browserless.io/function?token=" +
    encodeURIComponent(token);

  try {

    const response = await fetch(
      browserlessUrl,
      {
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
      }
    );

    const responseText =
      await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = {
        raw: responseText
      };
    }

    if (!response.ok) {

      return {
        statusCode: 502,
        headers,

        body: JSON.stringify({
          ok: false,
          error:
            "Browserless devolvió un error.",
          browserlessStatus:
            response.status,
          browserless: data
        })
      };

    }

    return {
      statusCode: 200,
      headers,

      body: JSON.stringify({
        ok: true,
        source: "COD Tracker",
        mode,
        query,
        result:
          data.data || data
      })
    };

  } catch (error) {

    return {
      statusCode: 500,
      headers,

      body: JSON.stringify({
        ok: false,
        error:
          "Error comunicando con Browserless.",
        details:
          error && error.message
            ? error.message
            : String(error)
      })
    };

  }

};
