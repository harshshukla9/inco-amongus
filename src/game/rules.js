export const KILL_RANGE = 90;
export const KILL_COOLDOWN_MS = 12000;
export const MEETING_DISCUSS_MS = 15000;
export const VOTE_DURATION_MS = 20000;
export const ROLE_REVEAL_MS = 2500;
export const IMPOSTOR_COUNT = 1;

export const PHASE = {
  REVEAL: 'reveal',
  PLAYING: 'playing',
  DISCUSS: 'discuss',
  VOTE: 'vote',
  RESULTS: 'results',
  GAME_OVER: 'game_over',
};

export const assignRoles = (playerIds, impostorCount = IMPOSTOR_COUNT) => {
  const ids = playerIds.slice();
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
  }
  const impostors = new Set(ids.slice(0, Math.min(impostorCount, Math.max(1, ids.length - 1))));
  const roles = {};
  playerIds.forEach((id) => {
    roles[id] = impostors.has(id) ? 'impostor' : 'crewmate';
  });
  return roles;
};

export const livingPlayers = (players) =>
  players.filter((p) => p.alive !== false);

export const checkWinCondition = (players) => {
  const living = livingPlayers(players);
  const livingImpostors = living.filter((p) => p.role === 'impostor');
  const livingCrew = living.filter((p) => p.role !== 'impostor');

  if (livingImpostors.length === 0) {
    return { over: true, winner: 'crewmate', reason: 'Impostor ejected' };
  }
  if (livingImpostors.length >= livingCrew.length) {
    return { over: true, winner: 'impostor', reason: 'Impostors equal or outnumber crew' };
  }
  if (livingCrew.length === 0) {
    return { over: true, winner: 'impostor', reason: 'All crewmates eliminated' };
  }
  return { over: false };
};

export const resolveVotes = (votes, playerIds) => {
  // votes: { voterId: targetId | 'skip' }
  const tallies = { skip: 0 };
  playerIds.forEach((id) => {
    tallies[id] = 0;
  });

  Object.keys(votes).forEach((voterId) => {
    const choice = votes[voterId];
    if (choice === 'skip' || choice == null) {
      tallies.skip += 1;
      return;
    }
    if (tallies[choice] == null) tallies[choice] = 0;
    tallies[choice] += 1;
  });

  let best = null;
  let bestCount = -1;
  let tie = false;

  Object.keys(tallies).forEach((key) => {
    if (key === 'skip') return;
    const count = tallies[key];
    if (count > bestCount) {
      best = key;
      bestCount = count;
      tie = false;
    } else if (count === bestCount && count > 0) {
      tie = true;
    }
  });

  const skipCount = tallies.skip || 0;
  if (bestCount <= 0 || bestCount < skipCount) {
    return {
      ejectedId: null,
      tie: false,
      skipped: true,
      tallies,
      reason: 'Vote skipped',
    };
  }
  if (tie || bestCount === skipCount) {
    return {
      ejectedId: null,
      tie: true,
      skipped: false,
      tallies,
      reason: 'Tie vote — no one ejected',
    };
  }

  return {
    ejectedId: best,
    tie: false,
    skipped: false,
    tallies,
    reason: 'Player ejected',
  };
};

export const dist = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

export const findNearest = (from, candidates, maxRange) => {
  let best = null;
  let bestDist = maxRange;
  candidates.forEach((c) => {
    const d = dist(from, c);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  });
  return best;
};
