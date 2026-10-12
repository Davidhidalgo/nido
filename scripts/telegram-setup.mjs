import { mkdir, writeFile, chmod } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

// Keep credentials out of shell arguments, history and terminal output.
if (!process.stdin.isTTY) {
  console.error("Ejecuta pnpm run telegram:setup en un terminal interactivo.");
  process.exit(1);
}
const hiddenOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});
const input = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true });
process.stdout.write("Token de BotFather (oculto; pega y pulsa Intro): ");
const token = await new Promise((resolve) => {
  input.once("line", (line) => {
    resolve(line.trim());
    input.close();
  });
  input.once("SIGINT", () => {
    input.close();
    resolve("");
  });
});
process.stdout.write("\n");
if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
  console.error("Cancelado o formato de token inválido. No se ha cambiado la configuración.");
  process.exit(1);
}
const local = fileURLToPath(new URL("../.local/", import.meta.url));
const tokenFile = fileURLToPath(new URL("../.local/telegram-bot-token", import.meta.url));
await mkdir(local, { recursive: true, mode: 0o700 });
await chmod(local, 0o700);
await writeFile(tokenFile, token + "\n", { mode: 0o600 });
await chmod(tokenFile, 0o600);
await import("./prepare-local.mjs");
console.log(
  "Token guardado localmente. Telegram preparado; falta cargar la configuración en el gateway y autorizar vuestros usuarios.",
);
