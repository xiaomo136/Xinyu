import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig, getPublicConfig, getRootDir } from "./lib/app-config.js";
import { SessionStore } from "./lib/session-store.js";
import { ChatService } from "./services/chat-service.js";
import { AsrService } from "./services/asr-service.js";
import { TtsService } from "./services/tts-service.js";

const config = await loadConfig();
const rootDir = getRootDir();
const publicDir = path.join(rootDir, "public");

const sessionStore = new SessionStore(
  rootDir,
  config.conversation.maxHistoryTurns,
  config.conversation.summarySourceTurns
);
await sessionStore.init();

const chatService = new ChatService({ config, sessionStore });
const asrService = new AsrService({ config });
const ttsService = new TtsService({ config });

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApiRequest(req, res, requestUrl);
      return;
    }

    await serveStatic(res, requestUrl.pathname);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message || "服务器内部错误"
    });
  }
});

server.listen(config.app.port, config.app.host, () => {
  const lanUrls = getLanUrls(config.app.port);
  console.log(`[心语] Web 服务已启动`);
  console.log(`  本机: http://127.0.0.1:${config.app.port}`);
  for (const url of lanUrls) {
    console.log(`  局域网: ${url}`);
  }
});

async function handleApiRequest(req, res, requestUrl) {
  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    const ttsState = ttsService.getProviderState();
    const asrHealth = await getAsrHealth(config);
    sendJson(res, 200, {
      ok: true,
      appName: config.app.name,
      serverTime: new Date().toISOString(),
      providers: {
        llm: config.providers.llm.type,
        model: config.providers.llm.ollama?.model ?? "mock",
        asr: config.providers.asr.type,
        asrReady: asrHealth.ready,
        asrMessage: asrHealth.message,
        tts: config.providers.tts.type,
        ttsActiveProvider: ttsState.activeProvider,
        ttsAvailableProviders: ttsState.availableProviders
      },
      lanUrls: getLanUrls(config.app.port)
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/config") {
    sendJson(res, 200, {
      ok: true,
      config: getPublicConfig(config)
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/history") {
    sendJson(res, 200, {
      ok: true,
      state: sessionStore.getState()
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/reset") {
    const state = await sessionStore.reset();
    sendJson(res, 200, {
      ok: true,
      state
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/chat") {
    const body = await readJsonBody(req);
    const result = await chatService.chat(body);
    sendJson(res, 200, {
      ok: true,
      ...result
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/asr/recognize") {
    const body = await readJsonBody(req);
    const result = await asrService.transcribe(body);
    sendJson(res, 200, {
      ok: true,
      ...result
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/tts/synthesize") {
    const body = await readJsonBody(req);
    const result = await ttsService.synthesize(body);
    sendJson(res, 200, {
      ok: true,
      ...result
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/tts/provider") {
    sendJson(res, 200, {
      ok: true,
      ...ttsService.getProviderState()
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/tts/provider") {
    const body = await readJsonBody(req);
    const result = ttsService.setProvider(body.providerName);
    sendJson(res, 200, {
      ok: true,
      ...result
    });
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: "未找到接口"
  });
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.normalize(path.join(publicDir, safePath));
  if (!resolvedPath.startsWith(publicDir)) {
    sendJson(res, 403, { ok: false, error: "禁止访问" });
    return;
  }

  try {
    const fileContent = await fs.readFile(resolvedPath);
    res.writeHead(200, {
      "Content-Type": getContentType(resolvedPath)
    });
    res.end(fileContent);
  } catch {
    sendJson(res, 404, {
      ok: false,
      error: "文件不存在"
    });
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  return map[ext] ?? "application/octet-stream";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function getLanUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    for (const item of values ?? []) {
      if (item.family === "IPv4" && !item.internal) {
        urls.push(`http://${item.address}:${port}`);
      }
    }
  }
  return urls;
}

async function getAsrHealth(config) {
  if (config.providers.asr.type !== "funasr") {
    return {
      ready: false,
      message: "当前未启用 FunASR"
    };
  }

  const baseUrl = config.providers.asr.funasr?.baseUrl;
  if (!baseUrl) {
    return {
      ready: false,
      message: "未配置 FunASR 地址"
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`${baseUrl}/health`, {
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        ready: false,
        message: `FunASR health failed: ${response.status}`
      };
    }

    const payload = await response.json();
    return {
      ready: true,
      message: `${payload.model ?? "FunASR"} 已连接`
    };
  } catch {
    return {
      ready: false,
      message: "FunASR 未启动或不可达"
    };
  }
}
