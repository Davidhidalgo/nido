import { access, mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const action = process.argv[2];
if (!["prepare", "build", "start", "stop", "status"].includes(action)) {
  console.log("Uso: node scripts/honcho-local.mjs prepare|build|start|stop|status");
  process.exit(action ? 1 : 0);
}
const state = join(await realpath(join(root, ".local")), "honcho");
const source = join(root, ".runtime/honcho");
const envFile = join(state, ".env");
const compose = join(state, "compose.yaml");
if (action === "prepare") {
  await access(join(source, "Dockerfile"));
  await mkdir(state, { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      envFile,
      "LLM_OPENAI_API_KEY=\nAUTH_USE_AUTH=false\nTELEMETRY_ENABLED=false\nSENTRY_ENABLED=false\n",
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const service = (entrypoint, port = "") => `    build: ${JSON.stringify(source)}
    entrypoint: ${entrypoint}
    env_file: [${JSON.stringify(envFile)}]
    environment:
      DB_CONNECTION_URI: postgresql+psycopg://postgres:postgres@database:5432/postgres
      CACHE_URL: redis://redis:6379/0?suppress=true
      CACHE_ENABLED: "true"
    depends_on:
      database: {condition: service_healthy}
      redis: {condition: service_healthy}
${port}    restart: unless-stopped
`;
  await writeFile(
    compose,
    `services:
  api:
${service('["sh", "docker/entrypoint.sh"]', '    ports: ["127.0.0.1:8000:8000"]\n')}
  deriver:
${service('["/app/.venv/bin/python", "-m", "src.deriver"]')}
  database:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_DB: postgres
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - ${JSON.stringify(join(state, "postgres") + ":/var/lib/postgresql/data")}
      - ${JSON.stringify(join(source, "database/init.sql") + ":/docker-entrypoint-initdb.d/init.sql:ro")}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped
  redis:
    image: redis:8.2
    command: ["redis-server", "--appendonly", "yes"]
    volumes: [${JSON.stringify(join(state, "redis") + ":/data")}]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped
`,
    { mode: 0o600 },
  );
  console.log("Honcho preparado. Configura el proveedor en el archivo privado: " + envFile);
  process.exit(0);
}
if (action === "start") {
  const env = await readFile(envFile, "utf8");
  if (!/^LLM_(OPENAI|ANTHROPIC|GEMINI)_API_KEY=\S+/m.test(env))
    throw new Error("Falta configurar una clave de proveedor en el .env privado de Honcho.");
}
const commands = {
  build: ["build", "api", "deriver"],
  start: ["up", "-d"],
  stop: ["stop"],
  status: ["ps"],
};
// Use a separate client config: stale desktop credential helpers must not
// prevent public image pulls or change the operator's Docker credentials.
const dockerConfig = join(state, "docker-client");
await mkdir(dockerConfig, { recursive: true, mode: 0o700 });
await writeFile(
  join(dockerConfig, "config.json"),
  JSON.stringify({
    cliPluginsExtraDirs: [
      "/opt/homebrew/lib/docker/cli-plugins",
      "/usr/local/lib/docker/cli-plugins",
    ],
  }),
  { mode: 0o600 },
);
const endpoint = spawnSync(
  "docker",
  ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
  { encoding: "utf8" },
);
if (endpoint.error) throw endpoint.error;
if (endpoint.status !== 0) throw new Error("No se puede resolver el contexto Docker activo.");
const result = spawnSync(
  "docker-compose",
  ["-p", "nido-honcho", "-f", compose, ...commands[action]],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DOCKER_CONFIG: dockerConfig,
      DOCKER_HOST: process.env.DOCKER_HOST ?? endpoint.stdout.trim(),
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
