"""Dump decisions of one exported model from full OpenSpiel matches (square
scoring): the harness's features, logits and chosen action, plus the same
position (and match so far) as Games2's core sees it, for check_states.js to
recompute in JS.

  python tools/dump_states.py --model sq_reader --players 4 --matches 6 > /tmp/s.jsonl
  python tools/dump_states.py --model dd_hand --decks 2 --players 8 --matches 3 > /tmp/d.jsonl
"""
import argparse
import json
import os
import sys

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", "..", "..")
sys.path.insert(0, os.path.join(ROOT, "oh_hell_harness"))
sys.path.insert(0, os.path.join(HERE, ".."))
from export_models import CATALOG  # noqa: E402
from ohh import game as G  # noqa: E402
from ohh.agents import HeuristicPolicy, NetPolicy, Policy, RandomPolicy  # noqa: E402
from ohh.match import encoder_for_checkpoint, match_schedule, play_matches  # noqa: E402
from ohh.model import load_checkpoint  # noqa: E402


def his_card(c):
  return {"num": c // 4 + 2, "suit": c % 4}


def snapshot(L, info, me, ctx, schedule):
  """The position as Games2's OhHellCore holds it (only what stateFromCore reads)."""
  n = L.num_players
  cur = G.current_trick(L, info)
  done = info.tricks[:len(info.tricks) - (1 if cur else 0)]
  leaders = [t[0][0] for t in done]
  if cur:
    leader = cur[0][0]
  elif done:  # winner of the last trick leads
    leader = G.trick_winner(done[-1], G.card_suit(info.trump_card))[0]
  else:
    leader = (info.dealer + 1) % n
  plays = [[] for _ in range(n)]
  for t in info.tricks:
    for q, c in t:
      plays[q].append(his_card(c))
  in_cur = {q: c for q, c in cur}
  k = ctx.deal_index
  rounds = [{"handSize": h, "dealer": (info.dealer - k + j) % n} for j, h in enumerate(schedule)]
  players = []
  for q in range(n):
    bids = [h[2][q] for h in ctx.history] + ([info.bids[q]] if info.bids[q] >= 0 else [])
    players.append({
        "index": q, "bidded": info.bids[q] >= 0, "bid": max(info.bids[q], 0),
        "taken": info.tricks_won[q], "plays": [plays[q]], "played": q in in_cur,
        "trick": his_card(in_cur[q]) if q in in_cur else {"num": 0, "suit": 0},
        "hand": [his_card(c) for c in info.hand] if q == me else [],
        "bids": bids, "takens": [h[3][q] for h in ctx.history], "score": ctx.totals[q],
    })
  return {"players": players, "leaders": [leaders], "leader": leader, "dealer": info.dealer,
          "handSize": info.num_tricks, "trump": his_card(info.trump_card), "me": me,
          "roundNumber": k, "rounds": rounds}


class Recorder(Policy):
  """Plays the model greedily and prints every decision it makes."""

  def __init__(self, model, enc, L, schedule, model_id, decks):
    self.model, self.enc, self.L, self.schedule = model, enc, L, schedule
    self.model_id, self.decks, self.name = model_id, decks, model_id

  @torch.no_grad()
  def act(self, states, players):
    out = []
    for s, me in zip(states, players):
      x = self.enc.encode(s, me)
      mask = G.legal_mask(s)
      logits = self.model(torch.from_numpy(x)[None], torch.from_numpy(mask)[None])[0][0].numpy()
      info = G.decode(self.L, np.asarray(s.information_state_tensor(me)))
      legal = s.legal_actions(me)
      a = int(logits.argmax())
      print(json.dumps({"model": self.model_id, "D": self.decks, "N": self.L.num_players,
                        "x": np.flatnonzero(x).tolist(), "x_size": len(x),
                        "logits": [float(logits[b]) for b in legal], "legal": legal,
                        "action": a, "core": snapshot(self.L, info, me, s.ctx, self.schedule)}))
      out.append(a)
    return out


def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("--model", default="champion")
  ap.add_argument("--decks", type=int, default=1)
  ap.add_argument("--players", type=int, default=4)
  ap.add_argument("--matches", type=int, default=4)
  ap.add_argument("--app", default=os.path.join(ROOT, "OhHell-Claude"))
  ap.add_argument("--seed", type=int, default=0)
  args = ap.parse_args()
  n = args.players
  tmpl = dict((mid, src) for mid, _, src in CATALOG)[args.model][args.decks]
  model, ckpt = load_checkpoint(os.path.join(args.app, "models", tmpl.format(n=n)))
  game = G.load_game(ckpt["game_params"])
  L = G.Layout.from_game(game)
  enc = encoder_for_checkpoint(ckpt, L)
  schedule = match_schedule(n, 10, L.total_cards)  # the standard ladder (= Games2's)
  me = Recorder(model, enc, L, schedule, args.model, args.decks)
  others = [NetPolicy(model, enc, greedy=False, name="sampled"), HeuristicPolicy(L),
            RandomPolicy(args.seed)]
  rng = np.random.default_rng(args.seed)
  seatings = []
  for _ in range(args.matches):
    seats = [others[i] for i in rng.integers(len(others), size=n)]
    seats[int(rng.integers(n))] = me
    seatings.append(seats)
  play_matches(game, seatings, rng.integers(2**31, size=args.matches).tolist(), schedule, num_envs=8)


if __name__ == "__main__":
  main()
