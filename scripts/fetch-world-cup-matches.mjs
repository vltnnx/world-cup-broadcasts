import fs from "node:fs/promises";
import path from "node:path";

const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const API_URL = "https://api.football-data.org/v4/competitions/WC/matches";
const OUTFILE = path.resolve("public/data/world_cup_matches_api.json");

if (!API_TOKEN) {
  throw new Error("FOOTBALL_DATA_TOKEN is required.");
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
const matches = (payload.matches || []).map((match) => ({
  id: match.id,
  utcDate: match.utcDate,
  status: match.status,
  stage: match.stage,
  group: match.group,
  home_team: match.homeTeam?.name || "",
  away_team: match.awayTeam?.name || "",
  home_score: match.score?.fullTime?.home ?? match.score?.regularTime?.home ?? null,
  away_score: match.score?.fullTime?.away ?? match.score?.regularTime?.away ?? null,
  winner: match.score?.winner || "",
  last_updated: match.lastUpdated || "",
}));

await fs.mkdir(path.dirname(OUTFILE), { recursive: true });
await fs.writeFile(
  OUTFILE,
  `${JSON.stringify({
    source: "football-data.org",
    generated_at: new Date().toISOString(),
    matches,
  }, null, 2)}\n`,
);

console.log(`Wrote ${matches.length} matches to ${OUTFILE}`);
