# AI Trained bots for Oh Hell

Robots that play with the trained models (from the `oh_hell_harness`
self-play project) instead of the built-in AI, in this game's own engine. The
models were trained under exactly this game's rules: 10 + bid² for an exact
bid, −5·d(d+1)/2 for missing by d, and the dealer can't make the bids add up.

## Using it

In the pre-game screen, next to **Robots**, set **AI Trained bots** to how
many of the robots should use the trained models; the rest use the built-in AI.
An **AI Trained models** menu then appears with one entry per AI Trained bot, where
the host picks which model it plays. The menu only lists models that have a
version for the current number of players and decks. Robots are named after
their model, e.g. "Baylee (Square Reader)".

| Model | Plays |
|---|---|
| Champion | the trained strongest model for the table (= the Hand Player of that deck count) |
| Square Hand Player | each hand for the most points |
| Square Match Player | knows the match score and which hand of the ladder it is |
| Square Reader | also reads each opponent's bidding habits in this match |
| Square Closer | to win the match rather than for points |
| Square All-Rounder | to win matches against strong and imperfect players, reading opponents |
| Square Kingmaker | to win first; second, to make whoever is in first place lose (once exported) |
| Double-Deck Hand Player | double deck: each hand for the most points (identical cards cancel) |

Single-deck models cover 3–7 players; double-deck models cover 5–10 players.
Teams aren't supported: on team tables, or if a robot's model has no version
for the table, that robot uses the built-in AI and the server logs a line.

At each decision, a AI Trained bot also runs the built-in AI for the same seat.
That keeps the post-game analysis (AI bids, making probabilities, mistakes)
working, and the built-in AI still answers claims. Only the bid or card the
robot actually sends comes from the trained model.

## Files

- `model.js`: the models' inputs in plain JS (from the harness: `ohh/game.py`
  `EngineeredEncoder` and `MultiDeckEncoder`, `ohh/match.py` `MatchEncoder`
  and `BehaviorEncoder`) and the policy network (`ohh/model.py`). No
  dependencies.
- `strategy.js`: `StrategyModuleTrained`, which turns the core's deal and match
  state into the model's input. It is wired in by `buildStrategyModules` in
  `../ai.js`; the per-robot choice lives in `../core.js` (`trainedModels`).
- `models/index.json`: the exported models, their player and deck counts, and
  aliases (Champion points at the model it currently is).
- `models/<id>/D<decks>/N<players>.json` + `.bin`: one exported network
  (float32 weights).
- `export_models.py`: writes `models/` from the companion Oh Hell app's models.
- `tools/dump_states.py` + `tools/check_states.js`: check the JS against the
  Python on decisions from real matches.
- `tools/headless_match.js`: plays full matches in the real `OhHellCore`, no
  server needed.

## Re-exporting after retraining

These steps need Python with torch and an OpenSpiel build with
`scoring=square` and `num_decks`, plus the harness and the companion Oh Hell app
(their `models/catalog/<id>/p<N>.pt`, `models/square/`, `models/double/`).

```
cd web/trained_ai
python export_models.py --app /path/to/oh-hell-app --harness /path/to/oh_hell_harness
#   (or just some: --ids sq_kingmaker dd_match dd_reader dd_closer dd_allround dd_kingmaker)
for n in 3 4 5 6 7; do python tools/dump_states.py --model sq_reader --players $n --matches 6 > /tmp/s$n.jsonl; done
for n in 5 6 7 8 9 10; do python tools/dump_states.py --model dd_hand --decks 2 --players $n --matches 3 > /tmp/d$n.jsonl; done
node tools/check_states.js /tmp/s*.jsonl /tmp/d*.jsonl   # must report 0 differences
cd .. && node trained_ai/tools/headless_match.js 5 4 3 1 all  # 5 players, 4 AI Trained bots, 3 matches, single deck, every model
node trained_ai/tools/headless_match.js 8 4 2 2 all          # double deck
```

The exporter adds whatever models it finds, so newly trained ones (Square
Kingmaker, the rest of the double-deck lineup) appear in the menus after a
re-export.
