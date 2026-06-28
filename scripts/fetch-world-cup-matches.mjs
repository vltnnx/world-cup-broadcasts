import fs from "node:fs/promises";
import path from "node:path";

const API_TOKEN = process.env.FOOTBALL_DATA_API_TOKEN || process.env.FOOTBALL_DATA_TOKEN;
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
  throw new Error("FOOTBALL_DATA_API_TOKEN or FOOTBALL_DATA_TOKEN is required on match days.");
}

const response = await fetch(API_URL, {
  headers: {
    "X-Auth-Token": API_TOKEN,
  },
});

if (!response.ok) {
  throw new Error(`football-data.org request failed: ${response.status} ${response.statusText}`);
}

const currentContent = await fs.readFile(OUTFILE, "utf8").catch(() => "");
const currentPayload = parseJson(currentContent);
const payload = mergeMatchCache(await response.json(), currentPayload);
const nextContent = `${JSON.stringify(payload, null, 2)}\n`;

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

function parseJson(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (error) {
    console.warn("Existing football-data.org cache could not be parsed; replacing it.");
    return null;
  }
}

function mergeMatchCache(nextPayload, currentPayload) {
  if (!Array.isArray(nextPayload?.matches) || !Array.isArray(currentPayload?.matches)) {
    return nextPayload;
  }

  const previousMatches = new Map(currentPayload.matches.map((match) => [String(match.id), match]));

  return {
    ...nextPayload,
    matches: nextPayload.matches.map((match) => mergeMatch(match, previousMatches.get(String(match.id)))),
  };
}

function mergeMatch(nextMatch, previousMatch) {
  if (!previousMatch) return nextMatch;

  return {
    ...nextMatch,
    homeTeam: preserveKnownTeam(nextMatch.homeTeam, previousMatch.homeTeam),
    awayTeam: preserveKnownTeam(nextMatch.awayTeam, previousMatch.awayTeam),
  };
}

function preserveKnownTeam(nextTeam, previousTeam) {
  if (hasTeamIdentity(nextTeam) || !hasTeamIdentity(previousTeam)) return nextTeam;
  return previousTeam;
}

function hasTeamIdentity(team) {
  return Boolean(team?.id || team?.name || team?.shortName || team?.tla);
}
