require("dotenv").config();

const http = require("http");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const PORT = 3000;

const KOSTIUK_INSTRUCTIONS = `
Ти — Kostiuk AI, дружній сучасний AI-асистент.
Спілкуйся переважно українською, природно й живо, без сухого офіціозу.
Користувач може писати сленгом і матюками — не моралізуй через це.
Відповідай практично, зрозуміло й по суті.
Не вигадуй фактів.
Якщо користувач просить код — давай робочий код і коротко пояснюй, куди його вставити.
`;

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });

  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 12 * 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });

    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    sendJson(res, 200, {
      ok: true,
      name: "Kostiuk AI backend",
      endpoint: "POST /chat"
    });

    return;
  }

  if (req.method === "POST" && req.url === "/chat") {

    try {
      const raw = await readBody(req);
      const data = JSON.parse(raw || "{}");

      const message =
        typeof data.message === "string"
          ? data.message.trim()
          : "";

      const history =
        Array.isArray(data.history)
          ? data.history.slice(-30)
          : [];

      const image =
        typeof data.image === "string"
          ? data.image
          : null;

      if (!message && !image) {
        sendJson(res, 400, {
          error: "Порожнє повідомлення"
        });
        return;
      }

      let input = [];

      for (const item of history) {
        if (
          !item ||
          (item.role !== "user" &&
           item.role !== "assistant")
        ) {
          continue;
        }

        input.push({
          role: item.role,
          content: String(item.content || "")
        });
      }

      if (message && image) {
        input.push({
          role: "user",
          content: [
            {
              type: "input_text",
              text: message
            },
            {
              type: "input_image",
              image_url: image
            }
          ]
        });
      } else if (image) {
        input.push({
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: image
            }
          ]
        });
      } else {
        input.push({
          role: "user",
          content: message
        });
      }

      const response = await client.responses.create({
        model: "gpt-5.6-luna",
        instructions: KOSTIUK_INSTRUCTIONS,
        input: input
      });

      sendJson(res, 200, {
        reply:
          response.output_text ||
          "Я не зміг сформувати відповідь."
      });

    } catch (error) {

      console.error("OpenAI error:", error);

      sendJson(res, 500, {
        error: "Помилка OpenAI API",
        details: error.message
      });
    }

    return;
  }

  sendJson(res, 404, {
    error: "Not found"
  });
});

server.listen(PORT, () => {
  console.log("🔥 Kostiuk AI backend запущений!");
  console.log("🌐 http://localhost:" + PORT);
});