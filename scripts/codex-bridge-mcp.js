#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const serverInfo = {
  name: "codex-bridge",
  version: "0.1.0",
};

const repoRoot = "/Users/jzefan/work/proj/exam";
const codexBin = process.env.CODEX_BIN || "/usr/local/bin/codex";
const debugLogFile = process.env.CODEX_BRIDGE_DEBUG_LOG || "";

let inputBuffer = Buffer.alloc(0);
let transportMode = "auto";

function debugLog(message) {
  if (!debugLogFile) {
    return;
  }
  const line = `[${new Date().toISOString()}] ${message}\n`;
  void fs.appendFile(debugLogFile, line).catch(() => {});
}

debugLog(`server start pid=${process.pid}`);

function sendMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (transportMode === "line") {
    process.stdout.write(`${body.toString("utf8")}\n`);
    return;
  }
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function toolDefinition() {
  return {
    name: "codex_exec",
    description:
      "Run OpenAI Codex on a coding task and return Codex's final response. Use this for implementation, refactors, debugging, or code review work.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Task or instruction to send to Codex.",
        },
        cwd: {
          type: "string",
          description: `Working directory for Codex. Defaults to ${repoRoot}.`,
        },
        model: {
          type: "string",
          description: "Optional Codex model override, for example gpt-5.4.",
        },
        sandbox: {
          type: "string",
          description: "Codex sandbox mode.",
          enum: ["read-only", "workspace-write", "danger-full-access"],
          default: "workspace-write",
        },
        profile: {
          type: "string",
          description: "Optional Codex profile name from ~/.codex/config.toml.",
        },
        add_dirs: {
          type: "array",
          description: "Extra writable directories for Codex.",
          items: { type: "string" },
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  };
}

function resolveCwd(requestedCwd) {
  if (!requestedCwd) {
    return repoRoot;
  }
  return path.isAbsolute(requestedCwd)
    ? requestedCwd
    : path.resolve(repoRoot, requestedCwd);
}

async function runCodex(args) {
  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) {
    throw new Error("`prompt` is required.");
  }

  const cwd = resolveCwd(args.cwd);
  const sandbox = args.sandbox || "workspace-write";
  const outputFile = path.join(
    os.tmpdir(),
    `codex-mcp-last-message-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );

  const codexArgs = [
    "exec",
    "--full-auto",
    "--ephemeral",
    "--color",
    "never",
    "--sandbox",
    sandbox,
    "--cd",
    cwd,
    "--output-last-message",
    outputFile,
  ];

  if (args.model) {
    codexArgs.push("--model", args.model);
  }
  if (args.profile) {
    codexArgs.push("--profile", args.profile);
  }
  if (Array.isArray(args.add_dirs)) {
    for (const dir of args.add_dirs) {
      if (typeof dir === "string" && dir.trim()) {
        codexArgs.push("--add-dir", dir);
      }
    }
  }

  codexArgs.push(prompt);

  const child = spawn(codexBin, codexArgs, {
    cwd,
    env: {
      ...process.env,
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    if (stdout.length < 60000) {
      stdout += chunk.toString("utf8");
    }
  });

  child.stderr.on("data", (chunk) => {
    if (stderr.length < 60000) {
      stderr += chunk.toString("utf8");
    }
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  let finalMessage = "";
  try {
    finalMessage = (await fs.readFile(outputFile, "utf8")).trim();
  } catch {
    finalMessage = "";
  } finally {
    await fs.rm(outputFile, { force: true });
  }

  const transcript = [finalMessage, stderr.trim(), stdout.trim()]
    .filter(Boolean)
    .join("\n\n");

  if (exitCode !== 0) {
    return {
      content: [
        {
          type: "text",
          text: transcript || `Codex exited with status ${exitCode}.`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: transcript || "Codex completed successfully with no final message.",
      },
    ],
  };
}

async function handleRequest(message) {
  const { id, method, params } = message;
  debugLog(`request method=${method} id=${id ?? "null"}`);

  try {
    if (method === "initialize") {
      sendResult(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo,
      });
      return;
    }

    if (method === "notifications/initialized") {
      return;
    }

    if (method === "ping") {
      sendResult(id, {});
      return;
    }

    if (method === "tools/list") {
      sendResult(id, { tools: [toolDefinition()] });
      return;
    }

    if (method === "tools/call") {
      if (params?.name !== "codex_exec") {
        sendError(id, -32602, `Unknown tool: ${params?.name || "(missing name)"}`);
        return;
      }
      const result = await runCodex(params.arguments || {});
      sendResult(id, result);
      return;
    }

    sendError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    sendError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function parseFrames() {
  while (true) {
    const bufferText = inputBuffer.toString("utf8");
    const newlineIndex = bufferText.indexOf("\n");
    if (newlineIndex !== -1) {
      const line = bufferText.slice(0, newlineIndex).trim();
      if (line.startsWith("{") && line.endsWith("}")) {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          // Fall through to framed parsing when the line is not valid JSON.
        }
        if (parsed) {
          transportMode = "line";
          inputBuffer = Buffer.from(bufferText.slice(newlineIndex + 1), "utf8");
          void handleRequest(parsed);
          continue;
        }
      }
    }

    let headerEnd = inputBuffer.indexOf("\r\n\r\n");
    let delimiterLength = 4;
    if (headerEnd === -1) {
      headerEnd = inputBuffer.indexOf("\n\n");
      delimiterLength = 2;
    }
    if (headerEnd === -1) {
      debugLog(
        `waiting for header delimiter preview=${JSON.stringify(
          inputBuffer.toString("utf8"),
        )}`,
      );
      return;
    }

    const headerText = inputBuffer.slice(0, headerEnd).toString("utf8");
    debugLog(`header=${JSON.stringify(headerText)}`);
    const match = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      debugLog("missing content-length header");
      inputBuffer = Buffer.alloc(0);
      return;
    }

    const contentLength = Number(match[1]);
    transportMode = "framed";
    const bodyStart = headerEnd + delimiterLength;
    const bodyEnd = bodyStart + contentLength;
    if (inputBuffer.length < bodyEnd) {
      return;
    }

    const body = inputBuffer.slice(bodyStart, bodyEnd).toString("utf8");
    inputBuffer = inputBuffer.slice(bodyEnd);

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      debugLog(`invalid json body=${JSON.stringify(body)}`);
      continue;
    }

    void handleRequest(parsed);
  }
}

process.stdin.on("data", (chunk) => {
  debugLog(
    `stdin bytes=${chunk.length} preview=${JSON.stringify(chunk.toString("utf8"))}`,
  );
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  parseFrames();
});

process.stdin.on("end", () => {
  debugLog("stdin end");
  process.exit(0);
});
