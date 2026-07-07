#!/usr/bin/env node
import { spawn } from "node:child_process";

const stdin = await readStdin();
let payload;
try {
  payload = JSON.parse(stdin);
} catch {
  fail("Wrapper received invalid JSON payload on stdin.");
}

if (payload.family !== "seed_evidence_import") {
  fail(`Wrapper only supports seed_evidence_import, received ${payload.family}.`);
}

const input = payload.input ?? {};
const figmaSeedReference = String(input.figmaSeedReference ?? "").trim();
const originalDesignIntent = String(input.originalDesignIntent ?? "").trim();
const figmaRef = parseFigmaReference(figmaSeedReference);

if (!figmaSeedReference || !originalDesignIntent) {
  fail("Wrapper requires figmaSeedReference and originalDesignIntent.");
}

const agentCommand = process.env.IKRAN_REAL_AGENT_COMMAND || "agent";
const agentArgs = parseArgs(
  process.env.IKRAN_REAL_AGENT_ARGS,
  [
    "-p",
    "--yolo",
    "--trust",
    "--approve-mcps",
    "--output-format",
    "text"
  ]
);

const prompt = `
You are the external Agent for an Ikran Runtime seed_evidence_import receipt smoke.
Selected Agent profile: ${process.env.IKRAN_REAL_AGENT_ID || "unknown"}

This slice does not ask you to create candidates yet. It only verifies that the
Runtime injected the user's Figma seed reference and Description into the real
Agent boundary.

Figma seed reference:
${figmaSeedReference}

Description:
${originalDesignIntent}

Return ONLY this JSON object, preserving both input strings exactly:
{
  "receivedFigmaSeedReference": "${escapeForPrompt(figmaSeedReference)}",
  "receivedDescription": "${escapeForPrompt(originalDesignIntent)}",
  "agentAcknowledgement": "I received the Description and Figma seed reference."
}

Rules:
- Do not edit files.
- Do not call Figma MCP for this receipt smoke.
- Do not return Markdown or explanatory prose.
`.trim();

const result = await runAgent(agentCommand, [...agentArgs, prompt]);
if (result.code !== 0) {
  process.stderr.write(result.stderr);
  fail(`Real Agent exited with code ${result.code}.`);
}

if (result.stderr.trim()) {
  process.stderr.write(result.stderr);
}

const receipt = extractJson(result.stdout);
if (!isObject(receipt)) {
  fail(`Real Agent did not return a JSON receipt. stdout: ${result.stdout.slice(0, 500)}`);
}

if (receipt.receivedFigmaSeedReference !== figmaSeedReference) {
  fail("Real Agent receipt did not preserve the input figmaSeedReference.");
}
if (receipt.receivedDescription !== originalDesignIntent) {
  fail("Real Agent receipt did not preserve the input Description.");
}

process.stdout.write(JSON.stringify(buildReceiptPackage(receipt)));

function buildReceiptPackage(receipt) {
  const descriptionPreview = truncate(originalDesignIntent, 180);
  const acknowledgement =
    typeof receipt.agentAcknowledgement === "string" && receipt.agentAcknowledgement.trim()
      ? receipt.agentAcknowledgement.trim()
      : "The real Agent acknowledged the injected Description.";

  return {
    packageId: `seed-evidence-agent-receipt-${Date.now()}`,
    structuredEvidence: {
      source: {
        figmaSeedReference,
        originalDesignIntent
      },
      frame: {
        id: figmaRef.nodeId ? `figma-node-${figmaRef.nodeId.replaceAll(":", "-")}` : "figma-node-receipt",
        name: "Real Agent Receipt",
        bounds: {
          x: 0,
          y: 0,
          width: 800,
          height: 450
        }
      },
      designSignals: [
        {
          id: "signal-description-injected",
          label: "Description injected",
          evidence: `Real Agent returned the exact Description: ${descriptionPreview}`
        },
        {
          id: "signal-agent-boundary-live",
          label: "Real Agent boundary live",
          evidence: acknowledgement
        }
      ]
    },
    evidenceSurface: {
      id: "figma-surface-agent-receipt",
      kind: "figma",
      title: "Real Agent Receipt",
      sourceReference: figmaSeedReference,
      originalDesignIntent,
      dimensions: {
        width: 800,
        height: 450
      },
      summary: `Real Agent acknowledged receiving the Description: ${descriptionPreview}`
    }
  };
}

function parseFigmaReference(ref) {
  try {
    const url = new URL(ref);
    const parts = url.pathname.split("/").filter(Boolean);
    const designIndex = parts.findIndex((part) => part === "design" || part === "file");
    const fileKey = designIndex >= 0 ? parts[designIndex + 1] : "";
    return {
      fileKey,
      nodeId: normalizeNodeId(url.searchParams.get("node-id") || "")
    };
  } catch {
    return { fileKey: "", nodeId: "" };
  }
}

function normalizeNodeId(raw) {
  return raw.trim().replace("-", ":");
}

function escapeForPrompt(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function truncate(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
  });
}

function parseArgs(raw, fallback) {
  if (!raw || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
    return String(parsed).split(/\s+/).filter(Boolean);
  } catch {
    return raw.split(/\s+/).filter(Boolean);
  }
}

function runAgent(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function extractJson(text) {
  const direct = parseMaybeJson(text.trim());
  if (direct) return unwrapCommonAgentJson(direct);

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === "\"") {
          inString = false;
        }
        continue;
      }
      if (ch === "\"") inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = parseMaybeJson(text.slice(start, i + 1));
          if (parsed) return unwrapCommonAgentJson(parsed);
        }
      }
    }
  }
  return null;
}

function unwrapCommonAgentJson(value) {
  if (typeof value !== "object" || value === null) return value;
  for (const key of ["result", "response", "text", "message", "content"]) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      const parsed = extractJson(candidate);
      if (parsed) return parsed;
    }
  }
  return value;
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fail(reason) {
  process.stdout.write(JSON.stringify({
    status: "blocked",
    reason,
    openGaps: ["Real Agent did not return the expected Description receipt."]
  }));
  process.exit(0);
}
