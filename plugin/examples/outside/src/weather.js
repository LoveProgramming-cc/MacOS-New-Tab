// Weather data: Open-Meteo (no key needed, CC BY 4.0) and how its WMO codes turn into scenes.

const T = (key, fallback) => macos.i18n.t(key, fallback);
const isChinese = () => String(macos.i18n.language() || '').toLowerCase().startsWith('zh');

// The scenes the sky can show, in the order the panel and menus list them.
const SCENE_ORDER = ['clear', 'cloudy', 'drizzle', 'rain', 'storm', 'snow', 'blizzard', 'fog', 'sakura', 'leaves', 'fireflies', 'meteors'];
const SCENE_EMOJI = {
  clear: '☀️', cloudy: '⛅', drizzle: '🌦️', rain: '🌧️', storm: '⛈️', snow: '🌨️', blizzard: '❄️',
  fog: '🌫️', sakura: '🌸', leaves: '🍂', fireflies: '✨', meteors: '🌠'
};
const SCENE_FALLBACK = {
  clear: 'Clear', cloudy: 'Cloudy', drizzle: 'Drizzle', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snow',
  blizzard: 'Blizzard', fog: 'Fog', sakura: 'Cherry Blossoms', leaves: 'Falling Leaves', fireflies: 'Fireflies', meteors: 'Meteor Shower'
};
const sceneName = (scene) => T(`scene_${scene}`, SCENE_FALLBACK[scene] || scene);
const sceneEmoji = (scene, night) => (scene === 'clear' && night ? '🌙' : SCENE_EMOJI[scene] || '☀️');

// WMO weather interpretation codes → scene, strength, and the condition's own name.
function fromCode(code) {
  const c = Number(code);
  const pick = (scene, level, key, fallback) => ({ scene, level, label: T(key, fallback) });
  if (c === 0) return pick('clear', 1, 'wmo_clear', 'Clear sky');
  if (c === 1) return pick('clear', 1, 'wmo_mainly_clear', 'Mainly clear');
  if (c === 2) return pick('cloudy', 0.6, 'wmo_partly', 'Partly cloudy');
  if (c === 3) return pick('cloudy', 1.2, 'wmo_overcast', 'Overcast');
  if (c === 45 || c === 48) return pick('fog', 1, 'wmo_fog', 'Fog');
  if (c >= 51 && c <= 57) return pick('drizzle', { 51: 0.6, 53: 0.9, 55: 1.3, 56: 0.8, 57: 1.2 }[c] || 1, 'wmo_drizzle', 'Drizzle');
  if (c >= 61 && c <= 67) return pick('rain', { 61: 0.55, 63: 0.95, 65: 1.45, 66: 0.7, 67: 1.2 }[c] || 1, 'wmo_rain', 'Rain');
  if (c >= 71 && c <= 77) return pick('snow', { 71: 0.55, 73: 0.95, 75: 1.5, 77: 0.45 }[c] || 1, 'wmo_snow', 'Snow');
  if (c >= 80 && c <= 82) return pick('rain', { 80: 0.65, 81: 1.05, 82: 1.7 }[c] || 1, 'wmo_showers', 'Rain showers');
  if (c === 85 || c === 86) return pick('snow', c === 85 ? 0.8 : 1.4, 'wmo_snow_showers', 'Snow showers');
  if (c >= 95) return pick('storm', c === 95 ? 1.1 : 1.5, 'wmo_storm', 'Thunderstorm');
  return pick('cloudy', 0.8, 'wmo_partly', 'Partly cloudy');
}

// Compass direction the wind comes FROM → how it leans on screen (-1 left … 1 right).
function windLean(speedKmh, fromDegrees) {
  const strength = Math.min(1.2, Math.max(0, Number(speedKmh) || 0) / 38);
  const lean = -Math.sin(((Number(fromDegrees) || 0) * Math.PI) / 180);
  return Math.round(lean * strength * 100) / 100;
}

async function getJSON(url) {
  const response = await macos.fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response || !response.ok) throw new Error(`HTTP ${response?.status ?? '?'}`);
  return JSON.parse(response.text);
}

async function fetchWeather(city) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(city.lat)}&longitude=${encodeURIComponent(city.lon)}`
    + '&current=temperature_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m&timezone=auto';
  const data = await getJSON(url);
  const now = data.current || {};
  return {
    code: Number(now.weather_code ?? 0),
    temp: Number(now.temperature_2m),
    isDay: Number(now.is_day ?? 1) === 1,
    windSpeed: Number(now.wind_speed_10m) || 0,
    windDir: Number(now.wind_direction_10m) || 0,
    fetchedAt: Date.now()
  };
}

async function searchCities(name) {
  const query = String(name || '').trim();
  if (!query) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&format=json&language=${isChinese() ? 'zh' : 'en'}`;
  const data = await getJSON(url);
  return (data.results || []).map((r) => ({
    name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude
  }));
}

// A first guess with nothing asked: the city in the system time zone (Asia/Singapore → Singapore).
function guessCityName() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const city = zone.split('/').pop().replace(/_/g, ' ');
    return city && city !== 'UTC' ? city : '';
  } catch { return ''; }
}
