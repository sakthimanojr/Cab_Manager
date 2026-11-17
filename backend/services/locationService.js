// Reverse geocoding (OpenStreetMap Nominatim by default). Never invents coordinates.
export async function reverseGeocode(a) {
  if (a.gps && process.env.GEOCODE !== 'off') {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${a.gps.lat}&lon=${a.gps.lng}`,
        { headers: { 'User-Agent': 'cab-trip-manager' }, signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      if (j.display_name) return j.display_name;
    } catch { /* fall back to overlay text */ }
  }
  return a.location || null;
}
