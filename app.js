const BROADCAST_URLS = [
  "/data/world_cup_finland_broadcasts_simple_corrected.json",
  "data/world_cup_finland_broadcasts_simple_corrected.json",
  "public/data/world_cup_finland_broadcasts_simple_corrected.json",
];

const API_URLS = [
  "https://raw.githubusercontent.com/vltnnx/world-cup-broadcasts/refs/heads/main/public/data/api-cache/world-cup-matches.json",
];

const BUILD_INFO_URLS = [
  "/build-info.json",
  "build-info.json",
  "public/build-info.json",
];

const TYPE_LABELS = {
  live: "LIVE MATCH",
  highlights: "HIGHLIGHTS",
  rerun: "RE-RUN",
};

const DEFAULT_DURATIONS = {
  live: 120,
  highlights: 45,
  rerun: 120,
};

const state = {
  broadcasts: [],
  apiMatches: [],
  filters: loadStoredFilters(),
  view: "upcoming",
  showFinishedToday: false,
  buildVersion: "local",
  buildInfo: null,
  watched: new Set(JSON.parse(localStorage.getItem("worldCupWatched") || "[]")),
  calendarAdded: new Set(JSON.parse(localStorage.getItem("worldCupCalendarAdded") || "[]")),
  revealedResults: new Set(JSON.parse(localStorage.getItem("worldCupRevealedResults") || "[]")),
};

const feed = document.querySelector("#feed");
const dayTemplate = document.querySelector("#dayTemplate");
const cardTemplate = document.querySelector("#cardTemplate");
const filterButtons = document.querySelectorAll(".filter-pill");
const viewButtons = document.querySelectorAll(".view-button");
const watchMenu = document.querySelector(".watch-menu");
const watchMenuButton = document.querySelector(".watch-menu-button");
const watchMenuPanel = document.querySelector("#watchMenu");

init();

async function init() {
  setupWatchMenu();

  state.buildInfo = await loadBuildInfo();
  state.buildVersion = state.buildInfo?.version || state.buildInfo?.sha || "local";
  renderBuildMarker();

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      toggleTypeFilter(button.dataset.filter);
      syncFilterButtons();
      render();
    });
  });
  syncFilterButtons();

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      viewButtons.forEach((item) => item.classList.toggle("is-selected", item === button));
      render();
    });
  });

  try {
    const [broadcastData, apiData] = await Promise.all([
      fetchFirstJson(BROADCAST_URLS, { versioned: true }),
      fetchFirstJson(API_URLS, { cacheBust: String(Date.now()) }).catch(() => ({ matches: [] })),
    ]);
    state.apiMatches = normalizeApiMatches(apiData);
    state.broadcasts = normalizeBroadcasts(broadcastData);
    render();
  } catch (error) {
    feed.innerHTML = `<p class="error">Broadcast data could not be loaded.</p>`;
  }
}

function setupWatchMenu() {
  if (!watchMenu || !watchMenuButton || !watchMenuPanel) return;

  watchMenuButton.addEventListener("click", () => {
    setWatchMenuOpen(watchMenuPanel.hidden);
  });

  watchMenuPanel.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setWatchMenuOpen(false));
  });

  document.addEventListener("click", (event) => {
    if (watchMenuPanel.hidden || watchMenu.contains(event.target)) return;
    setWatchMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setWatchMenuOpen(false);
  });
}

function setWatchMenuOpen(isOpen) {
  if (!watchMenuButton || !watchMenuPanel) return;
  watchMenuPanel.hidden = !isOpen;
  watchMenuButton.setAttribute("aria-expanded", String(isOpen));
}

async function loadBuildInfo() {
  return fetchFirstJson(BUILD_INFO_URLS, {
    cacheBust: String(Date.now()),
    optional: true,
  });
}

function renderBuildMarker() {
  const marker = document.querySelector("#buildMarker");
  if (!marker) return;

  const sha = state.buildInfo?.short_sha || String(state.buildVersion).slice(0, 7);
  const builtAt = state.buildInfo?.built_at ? ` · ${formatBuildTime(state.buildInfo.built_at)}` : "";
  marker.textContent = `Build ${sha}${builtAt}`;
}

async function fetchFirstJson(urls, options = {}) {
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetch(versionedUrl(url, options), { cache: "no-cache" });
      if (response.ok) return response.json();
      lastError = new Error(`${url}: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  if (options.optional) return null;
  throw lastError;
}

function versionedUrl(url, options = {}) {
  const version = options.cacheBust || (options.versioned ? state.buildVersion : "");
  if (!version || version === "local") return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function normalizeBroadcasts(data) {
  const rows = Array.isArray(data) ? data : data.broadcasts || [];
  const enrichedRows = rows
    .filter((row) => row && row.id && row.date && row.start)
    .map((row) => enrichBroadcast(row));
  return linkRepeatedMatchData(enrichedRows);
}

function normalizeApiMatches(data) {
  const rows = Array.isArray(data) ? data : data.matches || [];
  return rows.filter(Boolean).map(normalizeApiMatch);
}

function normalizeApiMatch(match) {
  const homeScore = match.home_score ?? match.score?.fullTime?.home ?? match.score?.regularTime?.home ?? null;
  const awayScore = match.away_score ?? match.score?.fullTime?.away ?? match.score?.regularTime?.away ?? null;

  return {
    ...match,
    id: match.id,
    utcDate: match.utcDate || match.date || match.kickoff || "",
    status: match.status || "",
    stage: match.stage || "",
    group: match.group || "",
    home_team: match.home_team || match.homeTeam?.name || match.homeTeam?.shortName || "",
    home_team_tla: match.home_team_tla || match.homeTeam?.tla || "",
    away_team: match.away_team || match.awayTeam?.name || match.awayTeam?.shortName || "",
    away_team_tla: match.away_team_tla || match.awayTeam?.tla || "",
    home_score: homeScore,
    away_score: awayScore,
    winner: match.winner || match.score?.winner || "",
    last_updated: match.last_updated || match.lastUpdated || "",
  };
}

function enrichBroadcast(row) {
  const match = findApiMatch(row);
  if (!match) return { ...row };

  const homeTeam = row.home_team || match.home_team || match.homeTeam?.name || "";
  const awayTeam = row.away_team || match.away_team || match.awayTeam?.name || "";
  const score = getScore(match);

  return {
    ...row,
    api_match_id: row.api_match_id || String(match.id || ""),
    home_team: homeTeam,
    home_team_tla: row.home_team_tla || match.home_team_tla || match.homeTeam?.tla || "",
    away_team: awayTeam,
    away_team_tla: row.away_team_tla || match.away_team_tla || match.awayTeam?.tla || "",
    title: row.title || (homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : row.title),
    match_status: match.status || "",
    match_state: match.match_state || match.stage || "",
    match_last_updated: match.last_updated || match.lastUpdated || "",
    score,
    winner: match.winner || match.score?.winner || "",
  };
}

function linkRepeatedMatchData(rows) {
  const liveMatches = new Map();

  rows.forEach((row) => {
    const key = getMatchKey(row);
    if (row.type === "live" && key) liveMatches.set(key, row);
  });

  return rows.map((row) => {
    const key = getMatchKey(row);
    const liveRow = key ? liveMatches.get(key) : null;
    if (!liveRow || liveRow.id === row.id) return row;

    return {
      ...row,
      api_match_id: row.api_match_id || liveRow.api_match_id || "",
      home_team_tla: row.home_team_tla || liveRow.home_team_tla || "",
      away_team_tla: row.away_team_tla || liveRow.away_team_tla || "",
      match_status: row.match_status || liveRow.match_status || "",
      match_state: row.match_state || liveRow.match_state || "",
      match_last_updated: row.match_last_updated || liveRow.match_last_updated || "",
      score: row.score || liveRow.score || "",
      winner: row.winner || liveRow.winner || "",
    };
  });
}

function findApiMatch(row) {
  if (!state.apiMatches.length || row.type !== "live") return null;

  if (row.api_match_id) {
    const direct = state.apiMatches.find((match) => String(match.id) === String(row.api_match_id));
    if (direct) return direct;
  }

  const rowDate = row.date;
  const home = normalizeTeam(row.home_team);
  const away = normalizeTeam(row.away_team);
  const homeTla = normalizeTla(row.home_team_tla);
  const awayTla = normalizeTla(row.away_team_tla);

  if (homeTla && awayTla && rowDate && row.phase) {
    const byTla = state.apiMatches.find((match) => {
      const matchDate = getApiMatchDate(match);
      return matchDate === rowDate
        && normalizeTla(match.home_team_tla || match.homeTeam?.tla) === homeTla
        && normalizeTla(match.away_team_tla || match.awayTeam?.tla) === awayTla;
    });
    if (byTla) return byTla;
  }

  if (home && away && rowDate && row.phase) {
    const byTeams = state.apiMatches.find((match) => {
      const matchDate = getApiMatchDate(match);
      const matchHome = normalizeTeam(match.home_team || match.homeTeam?.name);
      const matchAway = normalizeTeam(match.away_team || match.awayTeam?.name);
      return matchDate === rowDate && matchHome === home && matchAway === away;
    });
    if (byTeams) return byTeams;
  }

  if (row.match_slot) {
    const directSlot = state.apiMatches.find((match) => String(match.match_slot || "") === String(row.match_slot));
    if (directSlot) return directSlot;

    const candidates = state.apiMatches
      .filter((match) => phaseMatches(row.phase, match.stage || match.phase))
      .filter((match) => getApiMatchDate(match) === rowDate)
      .sort((a, b) => kickoffDistance(row.start, a) - kickoffDistance(row.start, b));

    if (candidates.length && (candidates.length === 1 || kickoffDistance(row.start, candidates[0]) <= 90)) {
      return candidates[0];
    }
  }

  return null;
}

function render() {
  const rows = getVisibleRows();
  const today = getFinnishDateString(new Date());
  feed.innerHTML = "";

  if (!rows.length) {
    feed.innerHTML = `<p class="empty">No broadcasts for this view.</p>`;
    return;
  }

  for (const [date, broadcasts] of groupByDate(rows)) {
    const dayNode = dayTemplate.content.cloneNode(true);
    dayNode.querySelector("h2").textContent = dayLabel(date);
    dayNode.querySelector("time").textContent = formatDate(date);
    const finishedTodayRows = date === today && state.view === "upcoming"
      ? broadcasts.filter((row) => isHideableFinishedToday(row, today))
      : [];
    const visibleBroadcasts = finishedTodayRows.length && !state.showFinishedToday
      ? broadcasts.filter((row) => !finishedTodayRows.some((finishedRow) => finishedRow.id === row.id))
      : broadcasts;
    const finishedTodayToggle = dayNode.querySelector(".finished-today-toggle");
    if (finishedTodayRows.length) {
      finishedTodayToggle.hidden = false;
      finishedTodayToggle.setAttribute("aria-expanded", String(state.showFinishedToday));
      finishedTodayToggle.querySelector(".finished-today-label").textContent = state.showFinishedToday
        ? "hide finished today"
        : "show finished today";
      finishedTodayToggle.addEventListener("click", () => {
        state.showFinishedToday = !state.showFinishedToday;
        render();
      });
    }
    const cards = dayNode.querySelector(".cards");
    visibleBroadcasts.forEach((row) => cards.appendChild(createCard(row)));
    feed.appendChild(dayNode);
  }
}

function getVisibleRows() {
  const today = getFinnishDateString(new Date());
  return state.broadcasts
    .filter((row) => state.filters.has("all") || state.filters.has(row.type))
    .filter((row) => (state.view === "past" ? row.date < today : row.date >= today))
    .sort((a, b) => {
      if (a.date !== b.date) {
        return state.view === "past" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
      }
      return a.start.localeCompare(b.start);
    });
}

function toggleTypeFilter(filter) {
  if (filter === "all") {
    state.filters.clear();
    state.filters.add("all");
    saveStoredFilters();
    return;
  }

  state.filters.delete("all");
  if (state.filters.has(filter)) {
    state.filters.delete(filter);
  } else {
    state.filters.add(filter);
  }

  if (!state.filters.size) {
    state.filters.add("all");
  }

  saveStoredFilters();
}

function syncFilterButtons() {
  filterButtons.forEach((button) => {
    const selected = state.filters.has(button.dataset.filter);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function loadStoredFilters() {
  try {
    const allowed = new Set(["all", "live", "highlights", "rerun"]);
    const stored = JSON.parse(localStorage.getItem("worldCupFilters") || "[]");
    const filters = new Set(stored.filter((item) => allowed.has(item)));
    if (!filters.size || filters.has("all")) return new Set(["all"]);
    return filters;
  } catch (error) {
    return new Set(["all"]);
  }
}

function saveStoredFilters() {
  localStorage.setItem("worldCupFilters", JSON.stringify([...state.filters]));
}

function createCard(row) {
  const node = cardTemplate.content.cloneNode(true);
  const card = node.querySelector(".broadcast-card");
  const watchedInput = node.querySelector("input");
  const watchedLabel = node.querySelector(".watched span");
  const watchedState = getWatchedState(row);

  card.dataset.type = row.type;
  card.classList.toggle("is-watched", watchedState.kind === "direct");
  card.classList.toggle("is-linked-watched", watchedState.kind === "linked");
  node.querySelector(".start-time").textContent = row.start;
  node.querySelector(".type-label").textContent = TYPE_LABELS[row.type] || row.type.toUpperCase();
  renderTitle(node.querySelector("h3"), row);
  node.querySelector(".meta").textContent = metadata(row);
  const channelBadge = node.querySelector(".channel-badge");
  channelBadge.textContent = row.channel;
  channelBadge.classList.add(channelClass(row.channel));

  watchedInput.checked = watchedState.isWatched;
  watchedLabel.textContent = watchedState.label;
  watchedInput.addEventListener("change", () => {
    if (watchedInput.checked) {
      state.watched.add(row.id);
    } else {
      clearWatchedForMatch(row);
    }
    localStorage.setItem("worldCupWatched", JSON.stringify([...state.watched]));
    render();
  });

  const calendarButton = node.querySelector(".calendar-button");
  syncCalendarButton(calendarButton, row);
  calendarButton.addEventListener("click", () => {
    if (state.calendarAdded.has(row.id)) {
      state.calendarAdded.delete(row.id);
    } else {
      downloadIcs(row);
      state.calendarAdded.add(row.id);
    }

    localStorage.setItem("worldCupCalendarAdded", JSON.stringify([...state.calendarAdded]));
    syncCalendarButton(calendarButton, row);
  });

  return node;
}

function syncCalendarButton(button, row) {
  const isAdded = state.calendarAdded.has(row.id);
  button.classList.toggle("is-added", isAdded);
  button.setAttribute("aria-pressed", String(isAdded));
  button.querySelector("span:last-child").textContent = isAdded ? "Added to Calendar" : "Add to Calendar";
}

function renderTitle(titleNode, row) {
  if (row.type === "highlights") {
    titleNode.textContent = row.title || titleFromTeams(row);
    return;
  }

  const teams = getDisplayTeams(row);

  if (!teams) {
    titleNode.textContent = row.title || titleFromTeams(row);
    return;
  }

  const result = formatResult(row.score);
  const resultIsRevealed = result.hasScore && isResultRevealed(row);

  titleNode.classList.add("match-line");
  titleNode.innerHTML = "";
  titleNode.append(
    createMatchPart("team-name home-team", teams.home),
    createResultPart(row, result, resultIsRevealed),
    createMatchPart("team-name away-team", teams.away),
  );
}

function createMatchPart(className, text) {
  const part = document.createElement("span");
  part.className = className;
  part.textContent = text;
  return part;
}

function createResultPart(row, result, resultIsRevealed) {
  if (!result.hasScore) {
    return createMatchPart("result-pill", "vs");
  }

  if (resultIsRevealed) {
    return createMatchPart("result-pill has-result", result.text);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "result-pill result-toggle";
  button.textContent = "show";
  button.setAttribute("aria-label", `Show result for ${titleFromTeams(row)}`);
  button.addEventListener("click", () => {
    state.revealedResults.add(getResultKey(row));
    localStorage.setItem("worldCupRevealedResults", JSON.stringify([...state.revealedResults]));
    render();
  });
  return button;
}

function getWatchedState(row) {
  if (state.watched.has(row.id)) {
    return { isWatched: true, kind: "direct", label: "Watched" };
  }

  const linkedRow = getLinkedWatchedRow(row);
  if (!linkedRow) {
    return { isWatched: false, kind: "none", label: "Watched" };
  }

  return {
    isWatched: true,
    kind: "linked",
    label: linkedRow.type === "live" ? "Watched (live)" : "Watched (re-run)",
  };
}

function getLinkedWatchedRow(row) {
  const key = getMatchKey(row);
  if (!key) return null;

  return state.broadcasts.find((candidate) => {
    return candidate.id !== row.id
      && candidate.type !== row.type
      && state.watched.has(candidate.id)
      && getMatchKey(candidate) === key;
  }) || null;
}

function clearWatchedForMatch(row) {
  const key = getMatchKey(row);
  state.watched.delete(row.id);
  if (!key) return;

  state.broadcasts.forEach((candidate) => {
    if (getMatchKey(candidate) === key) state.watched.delete(candidate.id);
  });
}

function isResultRevealed(row) {
  if (state.revealedResults.has(row.id) || state.revealedResults.has(getResultKey(row))) return true;

  const key = getMatchKey(row);
  if (!key) return false;

  return state.broadcasts.some((candidate) => {
    return candidate.id !== row.id
      && getMatchKey(candidate) === key
      && state.revealedResults.has(candidate.id);
  });
}

function getResultKey(row) {
  if (row.api_match_id) return `api:${row.api_match_id}`;
  return getMatchKey(row) || row.id;
}

function channelClass(channel) {
  const value = String(channel || "").toLowerCase();
  if (value.includes("mtv") || value.includes("katsomo")) return "channel-mtv";
  if (value.includes("yle")) return "channel-yle";
  if (value === "sub") return "channel-sub";
  return "channel-default";
}

function metadata(row) {
  const parts = [];
  if (row.group) parts.push(`Group ${row.group}`);
  if (row.phase && !parts.includes(row.phase)) parts.push(row.phase);
  if (row.score && !getDisplayTeams(row)) parts.push(row.score);
  if (row.match_status) parts.push(statusLabel(row));
  if (!parts.length && row.type === "highlights") parts.push("Highlights and analysis");
  if (!parts.length && row.type === "rerun") parts.push("Match re-run");
  return parts.join(" · ");
}

function statusLabel(row) {
  const status = prettyStatus(row.match_status);
  if (!isActiveMatchStatus(row.match_status)) return status;

  const updateTime = formatHelsinkiTime(row.match_last_updated);
  return updateTime ? `${status} · Updated ${updateTime}` : status;
}

function isActiveMatchStatus(status) {
  return [
    "IN_PLAY",
    "LIVE",
    "PAUSED",
    "EXTRA_TIME",
    "PENALTY_SHOOTOUT",
    "BREAK",
  ].includes(String(status || "").toUpperCase());
}

function isHideableFinishedToday(row, today) {
  return row.date === today
    && row.type === "live"
    && String(row.match_status || "").toUpperCase() === "FINISHED"
    && isPastFinishedGrace(row);
}

function isPastFinishedGrace(row) {
  const finishUpdatedAt = new Date(row.match_last_updated || "");
  const graceMs = 30 * 60 * 1000;

  if (!Number.isNaN(finishUpdatedAt.getTime())) {
    return Date.now() - finishUpdatedAt.getTime() >= graceMs;
  }

  const fallbackEnd = getBroadcastFallbackFinish(row);
  return fallbackEnd ? Date.now() - fallbackEnd.getTime() >= graceMs : false;
}

function getBroadcastFallbackFinish(row) {
  const minutesAfterStart = row.end ? 0 : DEFAULT_DURATIONS.live;
  const time = row.end || row.start;
  if (!row.date || !time) return null;
  const [year, month, day] = row.date.split("-").map(Number);
  const [hours, mins] = time.split(":").map(Number);
  if (![year, month, day, hours, mins].every(Number.isFinite)) return null;
  const dayOffset = row.end && row.end <= row.start ? 1 : 0;
  return new Date(Date.UTC(year, month - 1, day + dayOffset, hours - 3, mins + minutesAfterStart));
}

function groupByDate(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date).push(row);
  });
  return [...groups.entries()];
}

function dayLabel(dateString) {
  const today = getFinnishDateString(new Date());
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  if (dateString === today) return "Today";
  if (dateString === tomorrow) return "Tomorrow";
  if (dateString === yesterday) return "Yesterday";
  return weekdayName(dateString);
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateString}T12:00:00+03:00`));
}

function weekdayName(dateString) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    weekday: "long",
  }).format(new Date(`${dateString}T12:00:00+03:00`));
}

function formatHelsinkiTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatBuildTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getFinnishDateString(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00+03:00`);
  date.setDate(date.getDate() + days);
  return getFinnishDateString(date);
}

function downloadIcs(row) {
  const startParts = getCalendarParts(row.date, row.start, 0);
  const duration = DEFAULT_DURATIONS[row.type] || 120;
  const endParts = row.end
    ? getCalendarParts(row.date, row.end, row.end <= row.start ? 24 * 60 : 0)
    : getCalendarParts(row.date, row.start, duration);
  const title = `World Cup: ${row.title || titleFromTeams(row)}`;
  const description = [
    `Channel: ${row.channel}`,
    row.phase ? `Phase: ${row.phase}` : "",
    row.group ? `Group: ${row.group}` : "",
    row.source_url ? `Source: ${row.source_url}` : "",
  ].filter(Boolean).join("\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//World Cup Finland Broadcasts//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(row.id)}@world-cup-finland`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART;TZID=Europe/Helsinki:${startParts.stamp}`,
    `DTEND;TZID=Europe/Helsinki:${endParts.stamp}`,
    `SUMMARY:${escapeIcs(title)}`,
    `LOCATION:${escapeIcs(row.channel)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${row.id}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function getCalendarParts(dateString, time, offsetMinutes) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hours, mins] = time.split(":").map(Number);
  const totalMinutes = hours * 60 + mins + offsetMinutes;
  const dayOffset = Math.floor(totalMinutes / (24 * 60));
  const minuteOfDay = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const date = new Date(Date.UTC(year, month - 1, day + dayOffset, 12));
  const localDate = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const localTime = `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}${String(minuteOfDay % 60).padStart(2, "0")}00`;
  return { stamp: `${localDate}T${localTime}` };
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function titleFromTeams(row) {
  if (row.home_team && row.away_team) return `${row.home_team} vs ${row.away_team}`;
  return row.title || "World Cup broadcast";
}

function getDisplayTeams(row) {
  if (row.home_team || row.away_team) {
    return {
      home: row.home_team || "TBD",
      away: row.away_team || "TBD",
    };
  }

  const title = row.title || "TBD vs TBD";
  const split = title.split(/\s+(?:vs|v|-|–)\s+/i);
  if (split.length >= 2) {
    return {
      home: split[0],
      away: split.slice(1).join(" vs "),
    };
  }

  return null;
}

function formatResult(score) {
  const value = String(score || "").trim();
  const match = value.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!match) return { text: "vs", hasScore: false };
  return { text: `${match[1]}–${match[2]}`, hasScore: true };
}

function normalizeTeam(team) {
  return String(team || "")
    .toLowerCase()
    .replace(/\band\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeTla(tla) {
  return String(tla || "").trim().toUpperCase();
}

function getMatchKey(row) {
  if (!["live", "rerun"].includes(row.type)) return "";
  const homeTla = normalizeTla(row.home_team_tla);
  const awayTla = normalizeTla(row.away_team_tla);
  if (homeTla && awayTla) {
    return [
      normalizePhase(row.phase),
      normalizeTeam(row.group),
      homeTla,
      awayTla,
    ].join("|");
  }

  const teams = getDisplayTeams(row);
  const home = normalizeTeam(teams?.home);
  const away = normalizeTeam(teams?.away);
  if (!home || !away || home === "tbd" || away === "tbd") return "";

  return [
    normalizePhase(row.phase),
    normalizeTeam(row.group),
    home,
    away,
  ].join("|");
}

function getApiMatchDate(match) {
  const value = match.utcDate || match.date || match.kickoff;
  if (!value) return "";
  return getFinnishDateString(new Date(value));
}

function kickoffDistance(start, match) {
  const value = match.utcDate || match.date || match.kickoff;
  if (!value || !start) return Number.POSITIVE_INFINITY;
  const apiTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Helsinki",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
  return Math.abs(minutesFromTime(start) - minutesFromTime(apiTime));
}

function minutesFromTime(time) {
  const [hours, mins] = String(time).split(":").map(Number);
  return hours * 60 + mins;
}

function phaseMatches(localPhase, apiPhase) {
  return normalizePhase(localPhase) === normalizePhase(apiPhase);
}

function normalizePhase(phase) {
  const value = String(phase || "").toLowerCase().replace(/[_-]/g, " ");
  if (value.includes("group")) return "group";
  if (value.includes("32")) return "round32";
  if (value.includes("16")) return "round16";
  if (value.includes("quarter")) return "quarterfinal";
  if (value.includes("semi")) return "semifinal";
  if (value.includes("third")) return "thirdplace";
  if (value.includes("final")) return "final";
  return value.replace(/[^a-z0-9]/g, "");
}

function getScore(match) {
  if (match.score_text) return match.score_text;
  const fullTime = match.score?.fullTime;
  const regular = match.score?.regularTime;
  const score = fullTime || regular;
  if (score && Number.isFinite(score.home) && Number.isFinite(score.away)) {
    return `${score.home}-${score.away}`;
  }
  if (Number.isFinite(match.home_score) && Number.isFinite(match.away_score)) {
    return `${match.home_score}-${match.away_score}`;
  }
  return "";
}

function prettyStatus(status) {
  return String(status || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
