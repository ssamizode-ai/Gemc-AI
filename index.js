require("dotenv").config();

const express = require("express");
const path = require("path");
const Groq = require("groq-sdk");
const { tavily } = require("@tavily/core");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const tvly = process.env.TAVILY_API_KEY
  ? tavily({ apiKey: process.env.TAVILY_API_KEY })
  : null;

// Вазъи сервер
app.get("/api/status", (req, res) => {
  res.json({
    name: "GemC AI",
    status: "online",
    internetSearch: Boolean(tvly),
    message: "Салом! Ман GemC AI ҳастам."
  });
});

// Муайян кардани саволҳое, ки ҷустуҷӯи интернет мехоҳанд
function needsWebSearch(message) {
  const text = message.toLowerCase();

  const keywords = [
    "интернет", "ҷустуҷӯ", "кофта", "кофтан",
    "маълумоти нав", "ахбор", "хабарҳои имрӯз",
    "имрӯз", "ҳозир", "айни ҳол", "охирин",
    "навтарин", "нархи ҳозира", "соли 2026",
    "search", "google", "latest", "today",
    "current", "news", "recent", "look up",
    "find online", "what happened"
  ];

  return keywords.some(word => text.includes(word));
}

// Ҷустуҷӯи интернет
async function searchInternet(query) {
  if (!tvly) return [];

  try {
    const result = await tvly.search(query, {
      maxResults: 5,
      searchDepth: "basic"
    });

    return (result.results || []).slice(0, 5).map(item => ({
      title: item.title || "Манбаи интернетӣ",
      url: item.url || "",
      content: (item.content || "").slice(0, 1500)
    }));
  } catch (error) {
    console.error("Tavily search error:", error.message);
    return [];
  }
}

// Чат бо GemC AI
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: "Калиди GROQ_API_KEY дар файли .env танзим нашудааст."
      });
    }

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "Лутфан саволи худро навис."
      });
    }

    const userMessage = message.trim().slice(0, 4000);

    const safeHistory = Array.isArray(history)
      ? history
          .filter(item =>
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
          )
          .slice(-10)
          .map(item => ({
            role: item.role,
            content: item.content.slice(0, 4000)
          }))
      : [];

    // Агар савол маълумоти интернетиро талаб кунад, ҷустуҷӯ мекунем
    let sources = [];

    if (needsWebSearch(userMessage) && tvly) {
      sources = await searchInternet(userMessage);
    }

    const webContext = sources.length
      ? `
НАТИҶАҲОИ ҶУСТУҶӮИ ИНТЕРНЕТ:
${sources.map((item, index) =>
  `${index + 1}. ${item.title}
Суроға: ${item.url}
Маълумот: ${item.content}`
).join("\n\n")}

Қоидаҳо:
- Аз натиҷаҳои боло истифода бар.
- Маълумоти интернетиро ҳамчун далели санҷидашудаи мутлақ нишон надеҳ.
- Агар манбаъҳо маълумоти кофӣ надошта бошанд, инро бигӯ.
- Ҳангоми истифодаи маълумот, истиноди манбаъро дар ҷавоб нишон деҳ.
`
      : "";

    const systemPrompt =
      "Ту GemC AI ҳастӣ, ёвари зеҳни сунъии муфид, дақиқ ва боодоб. " +
      "Бо забони корбар ҷавоб деҳ. Агар корбар тоҷикӣ нависад, " +
      "бо забони тоҷикии равон ва беғалат ҷавоб деҳ. " +
      "Ба савол бевосита ҷавоб деҳ ва суханҳои нолозим нанавис. " +
      "Як фикрро такрор накун. " +
      "Агар савол таълимӣ бошад, бо қоида ва мисол фаҳмон. " +
      "Маълумоти сохтаро ҳамчун ҳақиқат пешниҳод накун. " +
      "Агар чизеро надонӣ, ошкоро бигӯ. " +
      "Агар аз ту пурсанд, ки туро кӣ сохтааст, ҷавоб деҳ: " +
      "Маро Самизода Абубакр сохтааст. " +
      "Агар пурсанд, ки оё аз офарандаат хушҳол ҳастӣ, " +
      "гӯй, ки хушҳол ҳастӣ ва аз ӯ миннатдорӣ. " +
      webContext;

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        ...safeHistory,
        {
          role: "user",
          content: userMessage
        }
      ],
      temperature: 0.7,
      max_tokens: 1200
    });

    const answer =
      completion.choices?.[0]?.message?.content?.trim();

    // Истинодҳоро ҳам дар ҷавоб нишон медиҳем
    let finalAnswer = answer || "Ҷавоб гирифта нашуд. Боз кӯшиш кун.";

    if (sources.length) {
      const sourceLinks = sources
        .filter(item => item.url)
        .map((item, index) => `${index + 1}. ${item.title}\n${item.url}`)
        .join("\n");

      if (sourceLinks) {
        finalAnswer += "\n\nМанбаъҳои интернетӣ:\n" + sourceLinks;
      }
    }

    res.json({
      answer: finalAnswer,
      sources
    });

  } catch (error) {
    console.error(
      "GemC AI error:",
      error.status || "",
      error.message || "Unknown error"
    );

    res.status(500).json({
      error: "Ҳоло ҷавоб гирифтан муяссар нашуд. Танзимоти API ва интернетро санҷ."
    });
  }
});

// ===============================
// СОХТАНИ СУРАТ БО GEMC AI
// ===============================
app.post("/api/image", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Тавсифи суратро навис." });
    }

    const baseUrl = "https://mrfakename-z-image-turbo.hf.space";

    const response = await fetch(
      `${baseUrl}/gradio_api/call/generate_image`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [prompt.trim().slice(0, 1500), 1024, 1024, 9, 42, true]
        })
      }
    );

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error("Дархости суратсоз қабул нашуд: " + responseText.slice(0, 200));
    }

    let job;
    try {
      job = JSON.parse(responseText);
    } catch {
      throw new Error("API ба ҷои JSON ҷавоби дигар дод: " + responseText.slice(0, 120));
    }

    if (!job.event_id) {
      throw new Error("ID-и дархост гирифта нашуд: " + responseText.slice(0, 120));
    }

    const resultResponse = await fetch(
      `${baseUrl}/gradio_api/call/generate_image/${job.event_id}`
    );
    const stream = await resultResponse.text();

    let result = null;
    const lines = stream.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "event: complete") {
        const dataLine = lines.slice(i + 1).find(line => line.startsWith("data:"));
        if (dataLine) result = JSON.parse(dataLine.slice(5).trim());
        break;
      }
      if (lines[i].trim() === "event: error") {
        throw new Error("Модел ҳангоми сохтани сурат хато дод.");
      }
    }

    const image = result?.[0];
    const imageUrl = typeof image === "string" ? image : image?.url;

    if (!imageUrl) {
      throw new Error("Сурат сохта нашуд. Ҷавоби API: " + stream.slice(0, 200));
    }

    res.json({
      success: true,
      image: imageUrl.startsWith("http")
        ? imageUrl
        : `${baseUrl}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`
    });
  } catch (error) {
    console.error("Image generation error:", error.message);
    res.status(500).json({
      error: error.message || "Сурат сохта нашуд. Боз кӯшиш кун."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`GemC AI server: http://127.0.0.1:${PORT}`);
  console.log(
    `Ҷустуҷӯи интернет: ${process.env.TAVILY_API_KEY ? "фаъол" : "ғайрифаъол"}`
  );
});
