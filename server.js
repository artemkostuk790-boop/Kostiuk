require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { Client, handle_file } = require("@gradio/client");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const PORT = process.env.PORT || 3000;

const HF_SPACE = "zerogpu-aoti/wan2-2-fp8da-aoti-faster";

const KOSTIUK_INSTRUCTIONS = `
Ти — Kostiuk AI, дружній сучасний AI-асистент.

Спілкуйся переважно українською, природно й живо, без сухого офіціозу.
Користувач може писати сленгом і матюками — не моралізуй через це.
Відповідай практично, зрозуміло й по суті.
Не вигадуй фактів.
Якщо користувач просить код — давай робочий код і коротко пояснюй, куди його вставити.

У тебе є інструмент generate_video для справжньої генерації відео.

ВАЖЛИВО:
- Якщо користувач просить створити або згенерувати відео і в запиті є прикріплене зображення — використовуй generate_video.
- Не кажи, що в тебе немає інструмента генерації відео, якщо прикріплене зображення є.
- Перед викликом generate_video сформуй нормальний детальний prompt для відеогенератора на основі побажань користувача.
- Якщо користувач просить відео, але зображення НЕ прикріплене — скажи, що для цього режиму потрібно спочатку прикріпити зображення.
- Після успішного виклику generate_video повідом користувачу, що відео готове.
`;

const VIDEO_TOOL = {
  type: "function",
  name: "generate_video",
  description:
    "Генерує справжнє відео з прикріпленого користувачем зображення за текстовим описом. Використовуй цей інструмент, коли користувач просить створити відео та має прикріплене зображення.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Детальний опис того, що має відбуватися у відео."
      }
    },
    required: ["prompt"],
    additionalProperties: false
  }
};

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

      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl).match(
    /^data:(image\/[^;]+);base64,(.+)$/i
  );

  if (!match) {
    throw new Error("Неправильний формат картинки.");
  }

  const mime = match[1];
  const base64 = match[2];

  const buffer = Buffer.from(base64, "base64");

  return new Blob([buffer], {
    type: mime
  });
}

/*
========================================================
🎬 СПРАВЖНЯ ГЕНЕРАЦІЯ ВІДЕО
========================================================
*/

async function generateVideoWithWan(image, prompt) {
  if (!process.env.HF_TOKEN) {
    throw new Error(
      "HF_TOKEN не знайдений у змінних середовища."
    );
  }

  if (!image) {
    throw new Error(
      "Для генерації відео потрібне прикріплене зображення."
    );
  }

  if (!prompt) {
    throw new Error(
      "Потрібен опис того, що має відбуватися у відео."
    );
  }

  console.log("🎬 Підключення до Hugging Face Space...");

  const gradio = await Client.connect(
    HF_SPACE,
    {
      token: process.env.HF_TOKEN
    }
  );

  console.log("🎬 Hugging Face підключено.");

  const imageBlob = dataUrlToBlob(image);
  const imageFile = await handle_file(imageBlob);

  console.log("🎬 Запускаю Wan2.2...");
  console.log("🎬 Prompt:", prompt);

  const result = await gradio.predict(
    "/generate_video",
    {
      input_image: imageFile,
      prompt: prompt,

      steps: 4,

      negative_prompt:
        "色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走",

      duration_seconds: 3.5,

      guidance_scale: 1,
      guidance_scale_2: 1,

      seed: 42,
      randomize_seed: true
    }
  );

  console.log("🎬 Wan2.2 завершив генерацію.");
  console.log("🎬 Result:", result);

  const output = result?.data?.[0];

  if (!output) {
    throw new Error(
      "Wan2.2 не повернув відеофайл."
    );
  }

  let videoUrl = null;

  if (typeof output === "string") {
    videoUrl = output;
  } else if (output.url) {
    videoUrl = output.url;
  } else if (output.path) {
    videoUrl = output.path;
  }

  if (!videoUrl) {
    throw new Error(
      "Не вдалося отримати URL відео."
    );
  }

  console.log("🎬 Video URL:", videoUrl);

  return videoUrl;
}

/*
========================================================
🌐 SERVER
========================================================
*/

const server = http.createServer(async (req, res) => {

  /*
  =========================
  CORS
  =========================
  */

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });

    res.end();
    return;
  }

  /*
  =========================
  ГОЛОВНА
  =========================
  */

  if (req.method === "GET" && req.url === "/") {

    const filePath =
      path.join(__dirname, "kostiuk.html");

    fs.readFile(filePath, (err, data) => {

      if (err) {

        console.error("HTML error:", err);

        sendJson(res, 500, {
          error: "Не вдалося відкрити Kostiuk"
        });

        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache"
      });

      res.end(data);

    });

    return;
  }

  /*
  =========================
  STATUS
  =========================
  */

  if (req.method === "GET" && req.url === "/api/status") {

    sendJson(res, 200, {
      ok: true,
      name: "Kostiuk AI",
      status: "online",
      video: "ready",
      videoTool: true
    });

    return;
  }

  /*
  =========================
  🤖 AI CHAT + TOOLS
  =========================
  */

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

      const input = [];

      /*
      Історія
      */

      for (const item of history) {

        if (
          !item ||
          (
            item.role !== "user" &&
            item.role !== "assistant"
          )
        ) {
          continue;
        }

        input.push({
          role: item.role,
          content: String(item.content || "")
        });
      }

      /*
      Поточне повідомлення
      */

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

      /*
      Даємо AI справжній інструмент
      */

      let response =
        await openai.responses.create({

          model: "gpt-5.6-luna",

          instructions:
            KOSTIUK_INSTRUCTIONS,

          input,

          tools: [
            VIDEO_TOOL
          ],

          parallel_tool_calls: false
        });

      /*
      ====================================================
      🔧 ОБРОБКА TOOL CALL
      ====================================================
      */

      const toolCalls =
        (response.output || [])
          .filter(
            item =>
              item.type === "function_call"
          );

      let generatedVideo = null;

      if (toolCalls.length > 0) {

        /*
        Додаємо output моделі назад у conversation,
        щоб Responses API знав, який tool був викликаний.
        */

        input.push(...response.output);

        for (const toolCall of toolCalls) {

          if (
            toolCall.name !== "generate_video"
          ) {
            continue;
          }

          let args = {};

          try {

            args =
              JSON.parse(
                toolCall.arguments || "{}"
              );

          } catch {

            args = {};
          }

          /*
          Якщо немає картинки —
          відеогенерацію не запускаємо.
          */

          if (!image) {

            input.push({
              type: "function_call_output",
              call_id: toolCall.call_id,
              output: JSON.stringify({
                ok: false,
                error:
                  "Для генерації відео користувач повинен прикріпити зображення."
              })
            });

            continue;
          }

          try {

            console.log(
              "🤖 Kostiuk викликав generate_video"
            );

            const videoPrompt =
              typeof args.prompt === "string" &&
              args.prompt.trim()
                ? args.prompt.trim()
                : message;

            generatedVideo =
              await generateVideoWithWan(
                image,
                videoPrompt
              );

            input.push({
              type: "function_call_output",
              call_id: toolCall.call_id,
              output: JSON.stringify({
                ok: true,
                video: generatedVideo
              })
            });

          } catch (videoError) {

            console.error(
              "🎬 Tool video error:",
              videoError
            );

            input.push({
              type: "function_call_output",
              call_id: toolCall.call_id,
              output: JSON.stringify({
                ok: false,
                error:
                  videoError?.message ||
                  String(videoError)
              })
            });

          }
        }

        /*
        Другий запит:
        AI отримує результат tool і формує відповідь.
        */

        response =
          await openai.responses.create({

            model: "gpt-5.6-luna",

            instructions:
              KOSTIUK_INSTRUCTIONS,

            input,

            tools: [
              VIDEO_TOOL
            ],

            parallel_tool_calls: false
          });
      }

      let reply =
        response.output_text ||
        "Я не зміг сформувати відповідь.";

      /*
      Якщо відео створене —
      передаємо його фронтенду окремо.
      */

      sendJson(res, 200, {

        reply,

        video:
          generatedVideo || null

      });

    } catch (error) {

      console.error(
        "OpenAI error:",
        error
      );

      sendJson(res, 500, {

        error:
          "Помилка OpenAI API",

        details:
          error?.message ||
          String(error)

      });

    }

    return;
  }

  /*
  =========================
  🎬 ПРЯМИЙ VIDEO ENDPOINT
  =========================
  */

  if (req.method === "POST" && req.url === "/video") {

    try {

      console.log(
        "🎬 Отримано прямий запит на генерацію відео."
      );

      const raw =
        await readBody(req);

      const data =
        JSON.parse(raw || "{}");

      const image =
        typeof data.image === "string"
          ? data.image
          : "";

      const prompt =
        typeof data.prompt === "string"
          ? data.prompt.trim()
          : "";

      const video =
        await generateVideoWithWan(
          image,
          prompt
        );

      sendJson(res, 200, {

        ok: true,
        video

      });

    } catch (error) {

      console.error(
        "VIDEO ERROR:"
      );

      console.error(error);

      sendJson(res, 500, {

        error:
          "Не вдалося створити відео.",

        details:
          error?.message ||
          String(error)

      });

    }

    return;
  }

  /*
  =========================
  404
  =========================
  */

  sendJson(res, 404, {
    error: "Not found"
  });

});

server.listen(PORT, () => {

  console.log(
    "🔥 Kostiuk AI backend запущений!"
  );

  console.log(
    "🌐 Link: http://localhost:" + PORT
  );

  console.log(
    "🎬 Video Space:",
    HF_SPACE
  );

  console.log(
    "🤖 Video Tool: ENABLED"
  );

});