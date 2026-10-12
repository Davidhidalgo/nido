import { createServer } from "node:http";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Manual browser fixture: no Google, credentials, OpenClaw state or external calls.
const compiled = await build({
  entryPoints: [
    fileURLToPath(
      new URL("../integrations/nido-family/src/google-oauth-window.ts", import.meta.url),
    ),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
let pageOrigin,
  destination,
  received = false;
const receiver = createServer(async (req, res) => {
  for await (const _chunk of req) {
    /* Drain this empty test form. */
  }
  const valid = req.method === "POST" && req.headers.origin === pageOrigin;
  received ||= valid;
  res.writeHead(valid ? 200 : 400, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(
    valid
      ? "Prueba correcta: POST recibido desde el origen de Nido, sin depender del referrer del host."
      : "La prueba no recibió el origen esperado.",
  );
});
const page = createServer((req, res) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  if (req.url === "/window.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" }).end(compiled.outputFiles[0].text);
  } else if (req.url === "/test.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" })
      .end(`import {openOAuthWindow} from '/window.js';
      document.querySelector('#result').textContent = 'JavaScript de prueba listo.';
      document.querySelector('#popup').onclick = async () => {
        const popup = window.open('about:blank', '_blank');
        if (popup) popup.opener = null;
        await new Promise(resolve => setTimeout(resolve, 100));
        openOAuthWindow(${JSON.stringify(destination)}, popup);
      };
      document.querySelector('#same-window').onclick = () => {
        try { document.querySelector('#result').textContent = 'Resultado: ' + openOAuthWindow(${JSON.stringify(destination)}, window); }
        catch (error) { document.querySelector('#result').textContent = 'Error de navegador: ' + error.message; }
      };`);
  } else {
    res
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(
        `<!doctype html><meta charset="utf-8"><title>Prueba ficticia OAuth Nido</title><h1>Prueba de la ventana OAuth</h1><p>No conecta con Google ni utiliza datos personales.</p><p id="result">Cargando JavaScript de prueba…</p><button id="popup">Probar autorización</button><button id="same-window">Probar formulario sin ventana emergente</button><script type="module" src="/test.js"></script>`,
      );
  }
});
try {
  await new Promise((resolve, reject) =>
    receiver.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  destination = `http://127.0.0.1:${receiver.address().port}/result`;
  await new Promise((resolve, reject) =>
    page.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  pageOrigin = `http://127.0.0.1:${page.address().port}`;
  console.log(`Prueba ficticia: ${pageOrigin}`);
  console.log("Abre la página, pulsa el botón y comprueba el resultado. Después pulsa Enter aquí.");
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));
  process.stdin.pause();
  if (!received) throw new Error("El navegador no completó la prueba de origen.");
  console.log("Formulario OAuth verificado: origen conservado con POST entre puertos distintos.");
} finally {
  page.close();
  receiver.close();
  page.closeAllConnections();
  receiver.closeAllConnections();
}
