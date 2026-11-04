export function navigationUrl(
  origin: { latitude: number | null; longitude: number | null },
  destination: { latitude: number | null; longitude: number | null },
  provider: "google" | "apple" = "google",
) {
  for (const point of [origin, destination])
    if (
      point.latitude === null ||
      point.longitude === null ||
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      Math.abs(point.latitude) > 90 ||
      Math.abs(point.longitude) > 180
    )
      return null;
  const from = `${origin.latitude},${origin.longitude}`,
    to = `${destination.latitude},${destination.longitude}`;
  return provider === "apple"
    ? `https://maps.apple.com/?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=driving`;
}
