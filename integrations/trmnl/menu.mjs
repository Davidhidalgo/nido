// This projection contains display data only, never event descriptions or identifiers.
export function dateInZone(now, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(date, days) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function weekStart(now, timeZone) {
  const today = dateInZone(now, timeZone);
  return addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function validDate(date) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  );
}
export function buildMenu(
  events,
  { start, timeZone = "Europe/Madrid", now = new Date(), demo = false },
) {
  if (!validDate(start)) throw new Error("La fecha inicial debe ser YYYY-MM-DD y existir.");
  const fmt = (date, options) =>
    new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", ...options }).format(
      new Date(`${date}T12:00:00Z`),
    );
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return {
      label: fmt(date, { weekday: "short", day: "numeric" }),
      short: fmt(date, { weekday: "short" }),
      date,
      lunch: "",
      dinner: "",
    };
  });
  for (const event of events) {
    if (event.status === "cancelled") continue;
    const match = /^(Comida|Cena)\s*·\s*(.+)$/iu.exec(event.summary ?? "");
    if (!match) continue;
    const date =
      event.start?.date ??
      (event.start?.dateTime ? dateInZone(new Date(event.start.dateTime), timeZone) : undefined);
    const day = days.find((d) => d.date === date);
    if (!day) continue;
    const slot = match[1].toLowerCase() === "comida" ? "lunch" : "dinner";
    if (day[slot])
      throw new Error(
        `Hay más de una ${slot === "lunch" ? "comida" : "cena"} el ${date}; corrige el calendario antes de publicar.`,
      );
    day[slot] = match[2].replace(/\s+/gu, " ").trim();
  }
  const range = `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(addDays(start, 6), { day: "numeric", month: "short" })}`;
  return {
    title: "Menú familiar",
    week: `${demo ? "DEMO · " : ""}${range}`,
    range: `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(addDays(start, 6), { day: "numeric", month: "short" })}`,
    updated: new Intl.DateTimeFormat("es-ES", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(now),
    demo,
    days,
  };
}
export function webhookBody(menu) {
  const body = JSON.stringify({ merge_variables: menu });
  if (Buffer.byteLength(body, "utf8") > 2000)
    throw new Error(
      "El menú supera el límite conservador de 2000 bytes de TRMNL; acorta los títulos. No se ha publicado.",
    );
  return body;
}
export async function publishMenu(menu, webhookUrl, fetcher = fetch) {
  let url;
  try {
    url = new URL(webhookUrl);
  } catch {
    throw new Error("Configura TRMNL_WEBHOOK_URL con la URL del plugin privado.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/api/custom_plugins/")
  )
    throw new Error(
      "El webhook debe usar HTTPS y la ruta /api/custom_plugins/ del servidor TRMNL elegido.",
    );
  const body = webhookBody(menu);
  let response;
  try {
    response = await fetcher(url.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error(
      "No se pudo confirmar la entrega a TRMNL. Revisa la conexión; la URL privada no se muestra.",
    );
  }
  if (!response.ok)
    throw new Error(
      `TRMNL rechazó el envío (HTTP ${response.status}). No se reintenta automáticamente.`,
    );
}
