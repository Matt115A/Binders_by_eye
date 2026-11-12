import { useEffect, useState } from 'react';
import { BIOAI_READY, fetchPeers, humanBaseline, type HumanBaseline, myDatapoint } from './bioai';

/** Shared by every game with a live leaderboard (keep the copies identical). Loads other players' contributions once
 *  while `active`, and turns them into the "average human" at each stage of the game. Your own contributions are left
 *  out. Null while loading, offline, or until enough people have contributed. */
export function useHumanBaseline(game: string, dataset: string, score: ((item: number, response: string) => number | null) | null, active: boolean): HumanBaseline | null {
  const [human, setHuman] = useState<HumanBaseline | null>(null);
  useEffect(() => {
    if (!active || !score || !BIOAI_READY) return;
    let live = true;
    fetchPeers(game, dataset).then((p) => { if (live) setHuman(humanBaseline(p, myDatapoint(game, dataset), score!)); }).catch(() => { /* no average human this time */ });
    return () => { live = false; };
  }, [game, dataset, score, active]);
  return active ? human : null;
}
