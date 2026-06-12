import fs from "node:fs/promises";
import path from "node:path";

const API_TOKEN = process.env.FOOTBALL_DATA_API_TOKEN;
const API_URL = "https://api.football-data.org/v4/competitions/WC/matches";
const BROADCAST_FILE = path.resolve("public/data/world_cup_finland_broadcasts_simple_corrected.json");
const OUTFILE = path.resolve("public/data/api-cache/world-cup-matches.json");

const broadcastData = JSON.parse(await fs.readFile(BROADCAST_FILE, "utf8"));
const broadcasts = Array.isArray(broadcastData) ? broadcastData : broadcastData.broadcasts || [];
const today = getFinnishDateString(new Date());
const isMatchDay = broadcasts.some((item) => item?.date === today);

if (!isMatchDay) {
  console.log(`No Finnish broadcast rows for ${today}; skipping football-data.org request.`);
  process.exit(0);
}

if (!API_TOKEN) {
  throw new Error("FOOTBALL_DATA_API_TOKEN is required on match days.");
}

const response = await fetch(API_URL, {
  headers: {
    "X-Auth-Token": API_TOKEN,
  },
});

if (!response.ok) {
  throw new Error(`football-data.org request failed: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const nextContent = `${JSON.stringify(payload, null, 2)}\n`;
const currentContent = await fs.readFile(OUTFILE, "utf8").catch(() => "");

if (nextContent === currentContent) {
  console.log(`football-data.org cache is unchanged for ${today}.`);
  process.exit(0);
}

await fs.mkdir(path.dirname(OUTFILE), { recursive: true });
await fs.writeFile(OUTFILE, nextContent);

console.log(`Updated football-data.org cache at ${OUTFILE}`);

function getFinnishDateString(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
