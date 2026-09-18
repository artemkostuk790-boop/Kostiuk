require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const OpenAI = require("openai");
const { Client, handle_file } = require("@gradio/client");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const PORT = process.env.PORT || 3000;

const HF_SPACE =
  "zerogpu-aoti/wan2-2-fp8da-aoti-faster";

/*
========================================================
🎬 GENERATED VIDEO STORAGE
========================================================
*/

const videoStore = new Map();

const VIDEO_TTL = 30 * 60 * 1000;

function saveGeneratedVideo(buffer) {

  const id = crypto.randomUUID();

  videoStore.set(id, {
    buffer,
    createdAt: Date.now()
  });

  setTimeout(() => {
    videoStore.delete(id);
  }, VIDEO_TTL);

  return id;
}

function cleanupVideos() {

  const now = Date.now();

  for (const [id, video] of videoStore.entries()) {

    if (now - video.createdAt > VIDEO_TTL) {
      videoStore.delete(id);
    }

  }
}

setInterval(
  cleanupVideos,
  5 * 60 * 1000
);

/*
========================================================
🤖 KOSTIUK INSTRUCTIONS
========================================================
*/

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

/*
========================================================
🎬 VIDEO TOOL
========================================================
*/

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

/*
========================================================
📦 JSON RESPONSE
========================================================
*/

function sendJson(res, status, data) {

  res.writeHead(status, {

    "Content-Type":
      "application/json; charset=utf-8",

    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Headers":
      "Content-Type",

    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS"

  });

  res.end(
    JSON.stringify(data)
  );
}

/*
========================================================
📥 READ REQUEST BODY
========================================================
*/

function readBody(req) {

  return new Promise(
    (resolve, reject) => {

      let body = "";

      req.on(
        "data",
        chunk => {

          body += chunk;

          if (
            body.length >
            25 * 1024 * 1024
          ) {

            reject(
              new Error(
                "Request too large"
              )
            );

            req.destroy();
          }

        }
      );

      req.on(
        "end",
        () => resolve(body)
      );

      req.on(
        "error",
        reject
      );

    }
  );
}

/*
========================================================
🖼️ DATA URL → BLOB
========================================================
*/

function dataUrlToBlob(dataUrl) {

  const match =
    String(dataUrl).match(
      /^data:(image\/[^;]+);base64,(.+)$/i
    );

  if (!match) {

    throw new Error(
      "Неправильний формат картинки."
    );
  }

  const mime = match[1];
  const base64 = match[2];

  const buffer =
    Buffer.from(
      base64,
      "base64"
    );

  return new Blob(
    [buffer],
    {
      type: mime
    }
  );
}

/*
========================================================
🎬 WAN2.2 VIDEO GENERATION
========================================================
*/

async function generateVideoWithWan(
  image,
  prompt
) {

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

  console.log(
    "🎬 Підключення до Hugging Face Space..."
  );

  const gradio =
    await Client.connect(
      HF_SPACE,
      {
        token:
          process.env.HF_TOKEN
      }
    );

  console.log(
    "🎬 Hugging Face підключено."
  );

  const imageBlob =
    dataUrlToBlob(image);

  const imageFile =
    await handle_file(
      imageBlob
    );

  console.log(
    "🎬 Запускаю Wan2.2..."
  );

  console.log(
    "🎬 Prompt:",
    prompt
  );

  const result =
    await gradio.predict(
      "/generate_video",
      {

        input_image:
          imageFile,

        prompt:
          prompt,

        steps:
          4,

        negative_prompt:
          "色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走",

        duration_seconds:
          3.5,

        guidance_scale:
          1,

        guidance_scale_2:
          1,

        seed:
          42,

        randomize_seed:
          true

      }
    );

  console.log(
    "🎬 Wan2.2 завершив генерацію."
  );

  console.log(
    "🎬 Result:",
    result
  );

  const output =
    result?.data?.[0];

  if (!output) {

    throw new Error(
      "Wan2.2 не повернув відеофайл."
    );
  }

  let videoUrl = null;

  if (
    typeof output ===
    "string"
  ) {

    videoUrl =
      output;

  } else if (
    output.url
  ) {

    videoUrl =
      output.url;
  }

  if (!videoUrl) {

    throw new Error(
      "Не вдалося отримати URL відео."
    );
  }

  console.log(
    "🎬 HF Video URL:",
    videoUrl
  );

  /*
  ======================================================
  📥 Завантаження MP4 з HF
  ======================================================
  */

  console.log(
    "🎬 Завантажую MP4 з Hugging Face..."
  );

  const videoResponse =
    await fetch(videoUrl);

  if (!videoResponse.ok) {

    throw new Error(
      `Не вдалося завантажити відео з Hugging Face: ${videoResponse.status}`
    );
  }

  const arrayBuffer =
    await videoResponse.arrayBuffer();

  const videoBuffer =
    Buffer.from(arrayBuffer);

  if (!videoBuffer.length) {

    throw new Error(
      "Hugging Face повернув порожній відеофайл."
    );
  }

  console.log(
    "🎬 MP4 завантажено:",
    Math.round(
      videoBuffer.length /
      1024 /
      1024 *
      100
    ) / 100,
    "MB"
  );

  const videoId =
    saveGeneratedVideo(
      videoBuffer
    );

  const localVideoUrl =
    `/generated-video/${videoId}`;

  console.log(
    "🎬 Kostiuk Video URL:",
    localVideoUrl
  );

  return localVideoUrl;
}

/*
========================================================
🌐 HTTP SERVER
========================================================
*/

const server =
  http.createServer(
    async (req, res) => {

      /*
      ==================================================
      📡 GLOBAL REQUEST LOG
      ==================================================
      */

      console.log(
        `📡 REQUEST: ${req.method} ${req.url}`
      );

      /*
      ==================================================
      CORS PREFLIGHT
      ==================================================
      */

      if (
        req.method ===
        "OPTIONS"
      ) {

        console.log(
          "🌐 CORS OPTIONS request"
        );

        res.writeHead(
          204,
          {
            "Access-Control-Allow-Origin":
              "*",

            "Access-Control-Allow-Headers":
              "Content-Type",

            "Access-Control-Allow-Methods":
              "GET, POST, OPTIONS"
          }
        );

        res.end();

        return;
      }

      /*
      ==================================================
      🎬 GENERATED VIDEO
      ==================================================
      */

      if (
        req.method === "GET" &&
        req.url.startsWith(
          "/generated-video/"
        )
      ) {

        console.log(
          "🎬 Generated video request"
        );

        try {

          const videoId =
            req.url
              .split(
                "/generated-video/"
              )[1]
              .split("?")[0];

          const video =
            videoStore.get(
              videoId
            );

          if (!video) {

            sendJson(
              res,
              404,
              {
                error:
                  "Відео більше недоступне."
              }
            );

            return;
          }

          const buffer =
            video.buffer;

          const total =
            buffer.length;

          const range =
            req.headers.range;

          if (range) {

            const match =
              range.match(
                /bytes=(\d+)-(\d*)/
              );

            if (match) {

              const start =
                Number(match[1]);

              const requestedEnd =
                match[2]
                  ? Number(match[2])
                  : total - 1;

              const end =
                Math.min(
                  requestedEnd,
                  total - 1
                );

              if (
                start >= total ||
                start > end
              ) {

                res.writeHead(
                  416,
                  {
                    "Content-Range":
                      `bytes */${total}`
                  }
                );

                res.end();

                return;
              }

              const chunk =
                buffer.subarray(
                  start,
                  end + 1
                );

              res.writeHead(
                206,
                {

                  "Content-Type":
                    "video/mp4",

                  "Content-Length":
                    chunk.length,

                  "Content-Range":
                    `bytes ${start}-${end}/${total}`,

                  "Accept-Ranges":
                    "bytes",

                  "Cache-Control":
                    "no-cache",

                  "Access-Control-Allow-Origin":
                    "*"

                }
              );

              res.end(chunk);

              return;
            }
          }

          res.writeHead(
            200,
            {

              "Content-Type":
                "video/mp4",

              "Content-Length":
                total,

              "Accept-Ranges":
                "bytes",

              "Cache-Control":
                "no-cache",

              "Access-Control-Allow-Origin":
                "*"

            }
          );

          res.end(buffer);

        } catch (error) {

          console.error(
            "🎬 Generated video error:",
            error
          );

          sendJson(
            res,
            500,
            {
              error:
                "Помилка віддачі відео."
            }
          );
        }

        return;
      }

      /*
      ==================================================
      🏠 MAIN PAGE
      ==================================================
      */

      if (
        req.method === "GET" &&
        req.url === "/"
      ) {

        console.log(
          "🏠 Sending kostiuk.html"
        );

        const filePath =
          path.join(
            __dirname,
            "kostiuk.html"
          );

        fs.readFile(
          filePath,
          (err, data) => {

            if (err) {

              console.error(
                "HTML error:",
                err
              );

              sendJson(
                res,
                500,
                {
                  error:
                    "Не вдалося відкрити Kostiuk"
                }
              );

              return;
            }

            res.writeHead(
              200,
              {
                "Content-Type":
                  "text/html; charset=utf-8",

                "Cache-Control":
                  "no-cache"
              }
            );

            res.end(data);
          }
        );

        return;
      }

      /*
      ==================================================
      ❤️ STATUS
      ==================================================
      */

      if (
        req.method === "GET" &&
        req.url === "/api/status"
      ) {

        console.log(
          "❤️ Status request"
        );

        sendJson(
          res,
          200,
          {
            ok: true,
            name: "Kostiuk AI",
            status: "online",
            video: "ready",
            videoTool: true
          }
        );

        return;
      }

      /*
      ==================================================
      🤖 CHAT
      ==================================================
      */

      if (
        req.method === "POST" &&
        req.url === "/chat"
      ) {

        console.log(
          "📩 /chat отримав запит"
        );

        try {

          console.log(
            "📥 Читаю body /chat..."
          );

          const raw =
            await readBody(req);

          console.log(
            "📦 Body отримано:",
            raw.length,
            "символів"
          );

          let data;

          try {

            data =
              JSON.parse(
                raw || "{}"
              );

          } catch (jsonError) {

            console.error(
              "❌ JSON parse error:",
              jsonError
            );

            sendJson(
              res,
              400,
              {
                error:
                  "Неправильний JSON"
              }
            );

            return;
          }

          const message =
            typeof data.message ===
            "string"
              ? data.message.trim()
              : "";

          const history =
            Array.isArray(
              data.history
            )
              ? data.history.slice(-30)
              : [];

          const image =
            typeof data.image ===
            "string"
              ? data.image
              : null;

          console.log(
            "📝 Message:",
            message
              ? `"${message.slice(0,100)}"`
              : "[без тексту]"
          );

          console.log(
            "🖼️ Image:",
            image
              ? "YES"
              : "NO"
          );

          console.log(
            "📚 History:",
            history.length
          );

          if (
            !message &&
            !image
          ) {

            sendJson(
              res,
              400,
              {
                error:
                  "Порожнє повідомлення"
              }
            );

            return;
          }

          const input = [];

          /*
          ----------------------------------------------
          HISTORY
          ----------------------------------------------
          */

          for (
            const item of history
          ) {

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
              role:
                item.role,

              content:
                String(
                  item.content ||
                  ""
                )
            });
          }

          /*
          ----------------------------------------------
          CURRENT MESSAGE
          ----------------------------------------------
          */

          if (
            message &&
            image
          ) {

            input.push({

              role:
                "user",

              content: [

                {
                  type:
                    "input_text",

                  text:
                    message
                },

                {
                  type:
                    "input_image",

                  image_url:
                    image
                }

              ]

            });

          } else if (image) {

            input.push({

              role:
                "user",

              content: [

                {
                  type:
                    "input_image",

                  image_url:
                    image
                }

              ]

            });

          } else {

            input.push({

              role:
                "user",

              content:
                message

            });
          }

          console.log(
            "🤖 Відправляю запит OpenAI..."
          );

          /*
          ----------------------------------------------
          OPENAI
          ----------------------------------------------
          */

          let response =
            await openai.responses.create({

              model:
                "gpt-5.6-luna",

              instructions:
                KOSTIUK_INSTRUCTIONS,

              input,

              tools: [
                VIDEO_TOOL
              ],

              parallel_tool_calls:
                false

            });

          console.log(
            "🤖 OpenAI відповідь отримано."
          );

          const toolCalls =
            (response.output || [])
              .filter(
                item =>
                  item.type ===
                  "function_call"
              );

          let generatedVideo =
            null;

          console.log(
            "🔧 Tool calls:",
            toolCalls.length
          );

          /*
          ==================================================
          🎬 VIDEO TOOL
          ==================================================
          */

          if (
            toolCalls.length > 0
          ) {

            input.push(
              ...response.output
            );

            for (
              const toolCall
              of toolCalls
            ) {

              if (
                toolCall.name !==
                "generate_video"
              ) {
                continue;
              }

              let args = {};

              try {

                args =
                  JSON.parse(
                    toolCall.arguments ||
                    "{}"
                  );

              } catch {

                args = {};
              }

              if (!image) {

                input.push({

                  type:
                    "function_call_output",

                  call_id:
                    toolCall.call_id,

                  output:
                    JSON.stringify({
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
                  typeof args.prompt ===
                    "string" &&
                  args.prompt.trim()
                    ? args.prompt.trim()
                    : message;

                generatedVideo =
                  await generateVideoWithWan(
                    image,
                    videoPrompt
                  );

                input.push({

                  type:
                    "function_call_output",

                  call_id:
                    toolCall.call_id,

                  output:
                    JSON.stringify({

                      ok:
                        true,

                      video:
                        generatedVideo

                    })

                });

              } catch (
                videoError
              ) {

                console.error(
                  "🎬 Tool video error:",
                  videoError
                );

                input.push({

                  type:
                    "function_call_output",

                  call_id:
                    toolCall.call_id,

                  output:
                    JSON.stringify({

                      ok:
                        false,

                      error:
                        videoError?.message ||
                        String(
                          videoError
                        )

                    })

                });
              }
            }

            /*
            ----------------------------------------------
            SECOND OPENAI REQUEST
            ----------------------------------------------
            */

            console.log(
              "🤖 Відправляю результат tool назад OpenAI..."
            );

            response =
              await openai.responses.create({

                model:
                  "gpt-5.6-luna",

                instructions:
                  KOSTIUK_INSTRUCTIONS,

                input,

                tools: [
                  VIDEO_TOOL
                ],

                parallel_tool_calls:
                  false

              });

            console.log(
              "🤖 Другу відповідь OpenAI отримано."
            );
          }

          const reply =
            response.output_text ||
            "Я не зміг сформувати відповідь.";

          console.log(
            "📤 Відправляю відповідь клієнту."
          );

          console.log(
            "🎬 Generated video:",
            generatedVideo
              ? "YES"
              : "NO"
          );

          sendJson(
            res,
            200,
            {

              reply,

              video:
                generatedVideo ||
                null

            }
          );

          console.log(
            "✅ /chat завершено успішно."
          );

        } catch (error) {

          console.error(
            "❌ /chat ERROR:"
          );

          console.error(
            error
          );

          sendJson(
            res,
            500,
            {

              error:
                "Помилка OpenAI API",

              details:
                error?.message ||
                String(error)

            }
          );
        }

        return;
      }

      /*
      ==================================================
      🎬 DIRECT VIDEO ENDPOINT
      ==================================================
      */

      if (
        req.method === "POST" &&
        req.url === "/video"
      ) {

        console.log(
          "🎬 Отримано прямий запит /video"
        );

        try {

          const raw =
            await readBody(req);

          const data =
            JSON.parse(
              raw || "{}"
            );

          const image =
            typeof data.image ===
            "string"
              ? data.image
              : "";

          const prompt =
            typeof data.prompt ===
            "string"
              ? data.prompt.trim()
              : "";

          const video =
            await generateVideoWithWan(
              image,
              prompt
            );

          sendJson(
            res,
            200,
            {

              ok:
                true,

              video

            }
          );

        } catch (error) {

          console.error(
            "❌ VIDEO ERROR:"
          );

          console.error(
            error
          );

          sendJson(
            res,
            500,
            {

              error:
                "Не вдалося створити відео.",

              details:
                error?.message ||
                String(error)

            }
          );
        }

        return;
      }

      /*
      ==================================================
      404
      ==================================================
      */

      console.log(
        "❓ 404:",
        req.method,
        req.url
      );

      sendJson(
        res,
        404,
        {
          error:
            "Not found"
        }
      );

    }
  );

/*
========================================================
🚀 START SERVER
========================================================
*/

server.listen(
  PORT,
  () => {

    console.log(
      "🔥 Kostiuk AI backend запущений!"
    );

    console.log(
      "🌐 Link: http://localhost:" +
      PORT
    );

    console.log(
      "🎬 Video Space:",
      HF_SPACE
    );

    console.log(
      "🤖 Video Tool: ENABLED"
    );

    console.log(
      "📡 Request logging: ENABLED"
    );

  }
);