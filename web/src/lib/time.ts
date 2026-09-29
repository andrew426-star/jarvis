// The console shows US Central time regardless of the device it's opened
// on: Andrew is in Ruston, and Jarvis's routines, briefs and task dates are
// all Central. A travelling laptop or a phone set to another zone would
// otherwise disagree with everything Jarvis says.
export const TIME_ZONE = "America/Chicago"

export function centralTime(date: Date, withSeconds = true): string {
  return date.toLocaleTimeString("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  })
}

export function centralDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

// "CDT" in summer, "CST" in winter.
export function centralZoneLabel(date: Date): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "short" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? "CT"
  )
}
