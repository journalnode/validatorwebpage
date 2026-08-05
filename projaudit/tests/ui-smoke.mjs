import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = resolve(testDirectory, "..");
const repoRoot = resolve(workerDirectory, "..");
const evidenceDirectory = resolve(repoRoot, "evidence");
const profileDirectory = resolve(repoRoot, ".tmp", "projaudit-edge-profile");
const afterScreenshot = resolve(evidenceDirectory, "projaudit-after.png");
const host = "127.0.0.1";
let port = 0;
const debugPort = 9333;

assertInsideRepo(profileDirectory);
assertInsideRepo(afterScreenshot);

const createScaffoldAuditResponse = await loadScaffoldModule();
const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);

    if (request.method === "POST" && requestUrl.pathname === "/projaudit/api/audit") {
      const body = await readJsonBody(request);
      const payload = createScaffoldAuditResponse(
        {},
        {
          appEnv: "local-staging",
          openRouterModel: "openai/gpt-5.2",
          gistPublic: true
        },
        body
      );

      response.writeHead(501, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(JSON.stringify(payload, null, 2));
      return;
    }

    await serveStaticFile(requestUrl.pathname, response);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

let browser;

try {
  await rm(profileDirectory, { recursive: true, force: true });
  await listen(server, 0, host);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local staging server did not expose a TCP port.");
  port = address.port;

  browser = spawn(
    findBrowser(),
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDirectory}`,
      "--window-size=1440,1800",
      `http://${host}:${port}/#audit-suite`
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    }
  );

  const page = await waitForDebugPage();
  const client = await createCdpClient(page.webSocketDebuggerUrl);

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1800,
    deviceScaleFactor: 1,
    mobile: false
  });

  const submission = await client.send("Runtime.evaluate", {
    expression: `(
      async function () {
        const waitFor = async (predicate, timeoutMs) => {
          const started = Date.now();
          while (!predicate()) {
            if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for Audit Suite state");
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };

        await waitFor(() => document.readyState === "complete", 5000);
        const form = document.getElementById("projaudit-form");
        const status = document.getElementById("audit-form-status");
        const responseOutput = document.getElementById("audit-response");
        const singleMode = form.querySelector('input[name="audit-mode"][value="url"]');
        const surfacesMode = form.querySelector('input[name="audit-mode"][value="surfaces"]');
        const input = document.getElementById("audit-url");
        const brief = document.getElementById("audit-brief");

        input.value = "ftp://invalid.example.org";
        form.requestSubmit();
        await waitFor(() => status.dataset.state === "error", 2000);
        const invalidState = status.dataset.state;

        surfacesMode.checked = true;
        surfacesMode.dispatchEvent(new Event("change", { bubbles: true }));
        document.getElementById("surface-repository").value = "https://github.com/wizbubba1/validatorwebpage";
        document.getElementById("surface-proof").value = "https://pft.wizbubba.xyz/validator.json";
        form.requestSubmit();
        await waitFor(() => status.dataset.state === "success", 8000);
        const bundleBody = JSON.parse(responseOutput.textContent);
        const bundleState = status.dataset.state;
        const bundleSurfaceCount = Object.keys(bundleBody.input_received?.surfaces || {}).length;

        singleMode.checked = true;
        singleMode.dispatchEvent(new Event("change", { bubbles: true }));
        input.value = "https://pft.wizbubba.xyz/";
        brief.value = "Verify the local staging-compatible placeholder pipeline and structured response rendering.";
        form.requestSubmit();
        await waitFor(() => status.dataset.state === "success", 8000);

        const responseBody = JSON.parse(responseOutput.textContent);
        document.getElementById("audit-suite").scrollIntoView({ block: "start" });

        return {
          invalidState,
          bundleState,
          bundleSurfaceCount,
          state: status.dataset.state,
          statusText: status.textContent,
          command: responseBody.command,
          responseStatus: responseBody.status,
          appEnv: responseBody.app_env,
          receivedUrl: responseBody.input_received && responseBody.input_received.url
        };
      }
    )()`,
    awaitPromise: true,
    returnByValue: true
  });

  const result = submission.result?.value;
  if (!result || result.state !== "success") {
    throw new Error(`Audit Suite submission did not succeed: ${JSON.stringify(result)}`);
  }
  if (result.command !== "/projaudit" || result.responseStatus !== "NOT_IMPLEMENTED") {
    throw new Error(`Unexpected scaffold response: ${JSON.stringify(result)}`);
  }
  if (result.invalidState !== "error" || result.bundleState !== "success" || result.bundleSurfaceCount !== 2) {
    throw new Error(`Audit Suite mode coverage failed: ${JSON.stringify(result)}`);
  }

  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  await writeFile(afterScreenshot, Buffer.from(screenshot.data, "base64"));

  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  const mobileCheck = await client.send("Runtime.evaluate", {
    expression: `({
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth
    })`,
    returnByValue: true
  });
  if (!mobileCheck.result?.value?.noHorizontalOverflow) {
    throw new Error(`Audit Suite overflows on mobile: ${JSON.stringify(mobileCheck.result?.value)}`);
  }
  client.close();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    screenshot: relative(repoRoot, afterScreenshot),
    mobile: mobileCheck.result.value,
    ...result
  }, null, 2)}\n`);
} finally {
  await stopBrowser(browser);
  await closeServer(server);
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
}

async function loadScaffoldModule() {
  const sourcePath = resolve(workerDirectory, "src", "projaudit", "module.ts");
  const source = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    },
    fileName: sourcePath
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  const module = await import(dataUrl);
  return module.createScaffoldAuditResponse;
}

async function serveStaticFile(pathname, response) {
  const decodedPath = decodeURIComponent(pathname);
  const requested = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const normalized = normalize(requested);
  const filePath = resolve(repoRoot, normalized);
  assertInsideRepo(filePath);

  if (!existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
    ".toml": "text/plain; charset=utf-8"
  };
  response.writeHead(200, {
    "content-type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-store"
  });
  response.end(await readFile(filePath));
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : null;
}

function findBrowser() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  const browserPath = candidates.find(existsSync);
  if (!browserPath) throw new Error("No supported Chromium browser was found.");
  return browserPath;
}

async function waitForDebugPage() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${debugPort}/json`);
      const pages = await response.json();
      const page = pages.find((candidate) => candidate.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Browser startup can take a moment.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Timed out waiting for the headless browser.");
}

async function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolveRequest, rejectRequest } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectRequest(new Error(message.error.message));
    else resolveRequest(message.result);
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { resolveRequest, rejectRequest });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    }
  };
}

function listen(httpServer, listenPort, listenHost) {
  return new Promise((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(listenPort, listenHost, resolveListen);
  });
}

function closeServer(httpServer) {
  return new Promise((resolveClose) => {
    if (!httpServer.listening) {
      resolveClose();
      return;
    }
    httpServer.close(() => resolveClose());
  });
}

async function stopBrowser(browserProcess) {
  if (!browserProcess || browserProcess.exitCode !== null) return;
  browserProcess.kill();
  await Promise.race([
    new Promise((resolveExit) => browserProcess.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 2000))
  ]);
}

function assertInsideRepo(path) {
  const relativePath = relative(repoRoot, path);
  if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
    throw new Error(`Refusing to access path outside repo: ${path}`);
  }
}
