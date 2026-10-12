export function validateFamily(family) {
  if (
    !["demo", "google"].includes(family.mode) ||
    typeof family.writesEnabled !== "boolean" ||
    typeof family.menuCalendarId !== "string" ||
    !family.menuCalendarId ||
    typeof family.familyCalendarId !== "string" ||
    !family.familyCalendarId ||
    family.menuCalendarId === family.familyCalendarId
  )
    throw new Error("Configuración familiar inválida.");
  if (
    family.mode === "google" &&
    [family.menuCalendarId, family.familyCalendarId].some((id) => id.startsWith("demo-"))
  )
    throw new Error("Introduce los IDs reales de calendarios antes de activar Google.");
  if (typeof family.timeZone !== "string" || !family.timeZone)
    throw new Error("Falta la zona horaria IANA.");
  new Intl.DateTimeFormat("es", { timeZone: family.timeZone }).format();
  if (
    family.members &&
    (!Array.isArray(family.members) ||
      family.members.length > 20 ||
      family.members.some((name) => typeof name !== "string" || !name.trim() || name.length > 100))
  )
    throw new Error("Miembros familiares inválidos.");
  if (
    family.gatewayPort !== undefined &&
    (!Number.isInteger(family.gatewayPort) ||
      family.gatewayPort < 1024 ||
      family.gatewayPort > 65535 ||
      family.gatewayPort === 18790 ||
      family.gatewayPort === 18791)
  )
    throw new Error("Puerto del Gateway inválido o reservado para NOTE4.");
  const times = family.mealTimes;
  if (
    times &&
    (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(times.lunch) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(times.dinner) ||
      times.lunch === times.dinner ||
      !Number.isInteger(times.durationMinutes) ||
      times.durationMinutes < 1 ||
      times.durationMinutes > 240)
  )
    throw new Error("Horarios de comidas inválidos.");
  if (
    family.agendaCalendarIds !== undefined &&
    (!Array.isArray(family.agendaCalendarIds) ||
      family.agendaCalendarIds.length > 10 ||
      family.agendaCalendarIds.some((id) => typeof id !== "string" || !id) ||
      new Set(family.agendaCalendarIds).size !== family.agendaCalendarIds.length)
  )
    throw new Error("Calendarios adicionales inválidos.");
  const allowed = [
    family.menuCalendarId,
    family.familyCalendarId,
    ...(family.agendaCalendarIds ?? []),
  ];
  if (
    family.calendarNames !== undefined &&
    (!family.calendarNames ||
      typeof family.calendarNames !== "object" ||
      Array.isArray(family.calendarNames) ||
      Object.entries(family.calendarNames).some(
        ([id, name]) =>
          !allowed.includes(id) || typeof name !== "string" || !name.trim() || name.length > 200,
      ))
  )
    throw new Error("Nombres de calendarios inválidos.");
  if (
    family.calendarShortNames !== undefined &&
    (!family.calendarShortNames ||
      typeof family.calendarShortNames !== "object" ||
      Array.isArray(family.calendarShortNames) ||
      Object.entries(family.calendarShortNames).some(
        ([id, name]) =>
          !allowed.includes(id) ||
          typeof name !== "string" ||
          !name.trim() ||
          [...name].length > 16,
      ))
  )
    throw new Error("Nombres cortos de calendarios inválidos (máximo 16 caracteres).");
  const references = new Set(
    allowed.map((id) =>
      id === family.menuCalendarId
        ? "menu"
        : id === family.familyCalendarId
          ? "family"
          : `calendar:${id}`,
    ),
  );
  if (
    family.calendarAccess !== undefined &&
    (!family.calendarAccess ||
      typeof family.calendarAccess !== "object" ||
      Array.isArray(family.calendarAccess))
  )
    throw new Error("Permisos de calendarios inválidos.");
  for (const [agent, access] of Object.entries(family.calendarAccess ?? {})) {
    if (
      !["menu", "agenda"].includes(agent) ||
      !access ||
      !Array.isArray(access.read) ||
      !Array.isArray(access.write) ||
      access.read.length > 12 ||
      access.write.length > 12 ||
      new Set(access.read).size !== access.read.length ||
      new Set(access.write).size !== access.write.length ||
      access.read.some((ref) => !references.has(ref)) ||
      !access.read.includes(access.defaultCalendar) ||
      access.write.some(
        (ref) => !access.read.includes(ref) || (agent === "menu" ? ref !== "menu" : ref === "menu"),
      )
    )
      throw new Error(
        "Permisos de calendarios inválidos: revisa lectura, escritura, calendario por defecto y separación menú/agenda.",
      );
  }
}
