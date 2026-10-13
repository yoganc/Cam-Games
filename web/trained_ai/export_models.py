"""Export the trained Oh Hell models (oh_hell_harness checkpoints, as installed in
the companion Oh Hell app's models/ directory) for the pure-JS player here.

For every catalog model (same name at every table size) and each player count
and deck count it has, this writes models/<id>/D<decks>/N<players>.json (layout,
features, match inputs, architecture and the byte offset of every tensor) and
.bin (the policy network's weights, little-endian float32), plus
models/index.json listing what was exported. A model whose weights are
identical to another's (e.g. Champion = Square Hand Player) is exported once
and listed as an alias. Only the policy network is exported.

  python export_models.py --app /path/to/oh-hell-app --harness /path/to/oh_hell_harness
  python export_models.py ... --ids sq_reader dd_hand      # just these (index is merged)
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# id, name, {decks: checkpoint under the app's models/ ({n} = players)}.
# Square scoring only (this game's rules); the order is the menu order.
CATALOG = [
    ("champion", "Champion", {1: "square/ohh_p{n}.pt", 2: "double/ohh_p{n}.pt"}),
    ("sq_hand", "Square Hand Player", {1: "catalog/sq_hand/p{n}.pt"}),
    ("sq_match", "Square Match Player", {1: "catalog/sq_match/p{n}.pt"}),
    ("sq_reader", "Square Reader", {1: "catalog/sq_reader/p{n}.pt"}),
    ("sq_closer", "Square Closer", {1: "catalog/sq_closer/p{n}.pt"}),
    ("sq_allround", "Square All-Rounder", {1: "catalog/sq_allround/p{n}.pt"}),
    ("sq_kingmaker", "Square Kingmaker", {1: "catalog/sq_kingmaker/p{n}.pt"}),
    ("dd_hand", "Double-Deck Hand Player", {2: "catalog/dd_hand/p{n}.pt"}),
    ("dd_match", "Double-Deck Match Player", {2: "catalog/dd_match/p{n}.pt"}),
    ("dd_reader", "Double-Deck Reader", {2: "catalog/dd_reader/p{n}.pt"}),
    ("dd_closer", "Double-Deck Closer", {2: "catalog/dd_closer/p{n}.pt"}),
    ("dd_allround", "Double-Deck All-Rounder", {2: "catalog/dd_allround/p{n}.pt"}),
    ("dd_kingmaker", "Double-Deck Kingmaker", {2: "catalog/dd_kingmaker/p{n}.pt"}),
]
PLAYERS = {1: range(3, 8), 2: range(5, 11)}


def export(path, source, G, M, load_checkpoint):
  """(meta, weight bytes) for one checkpoint."""
  model, ckpt = load_checkpoint(path)
  params = ckpt["game_params"]
  if params.get("scoring") != "square":
    raise ValueError(f"{path}: not trained for square scoring")
  if ckpt["features"] not in ("engineered", "multideck"):
    raise ValueError(f"{path}: features {ckpt['features']} aren't ported")
  if model.priv_size:
    raise ValueError(f"{path}: privileged-critic models aren't supported")
  layout = G.Layout.from_game(G.load_game(params))
  base = G.make_encoder(ckpt["features"], layout)
  enc = M.encoder_for_checkpoint(ckpt, layout)
  assert enc.size == model.config["obs_size"], (enc.size, model.config["obs_size"])
  sd = {k: v.numpy().astype("<f4") for k, v in model.state_dict().items()}
  layers, blobs, off = [], [], 0
  names = [k[:-len(".weight")] for k in sd if k.endswith(".weight") and not k.startswith("value")]
  for name in names:  # trunk.0, trunk.2, ..., policy (ReLU after every trunk layer)
    w, b = sd[name + ".weight"], sd[name + ".bias"]
    layers.append({"name": name, "rows": int(w.shape[0]), "cols": int(w.shape[1]),
                   "w": off, "b": off + w.nbytes, "relu": name != "policy"})
    blobs += [w.tobytes(), b.tobytes()]
    off += w.nbytes + b.nbytes
  schedule = ckpt.get("match_schedule")
  match = None
  if schedule:
    match = {"num_deals": len(schedule), "schedule": list(schedule),
             "gap_edges": M.GAP_EDGES.tolist(), "behavior": None}
    if ckpt.get("behavior"):
      match["behavior"] = {"exact_edges": M.EXACT_EDGES.tolist(),
                           "bias_edges": M.BIAS_EDGES.tolist(),
                           "level_edges": M.LEVEL_EDGES.tolist()}
  meta = {
      "source": source, "iteration": ckpt.get("iteration"), "game_params": params,
      "features": ckpt["features"],
      "layout": {"num_players": layout.num_players, "num_suits": layout.num_suits,
                 "deck_size": layout.deck_size, "max_tricks": layout.max_tricks,
                 "num_decks": layout.num_decks, "copies": layout.copies},
      "obs_size": enc.size, "deal_obs_size": base.size, "num_actions": layout.num_actions,
      "bid_action_offset": layout.bid_action_offset,
      "feature_offsets": base.offsets, "match": match, "layers": layers,
  }
  return meta, b"".join(blobs)


def main():
  ap = argparse.ArgumentParser(description=__doc__,
                               formatter_class=argparse.RawDescriptionHelpFormatter)
  ap.add_argument("--app", default=os.path.join(HERE, "..", "..", "..", "OhHell-Claude"),
                  help="the companion Oh Hell app checkout (its models/ has the checkpoints)")
  ap.add_argument("--harness", default=os.path.join(HERE, "..", "..", "..", "oh_hell_harness"))
  ap.add_argument("--out", default=os.path.join(HERE, "models"))
  ap.add_argument("--ids", nargs="*", help="only these catalog ids (default: all found)")
  args = ap.parse_args()
  sys.path.insert(0, os.path.abspath(args.harness))
  from ohh import game as G  # noqa: E402
  from ohh import match as M  # noqa: E402
  from ohh.model import load_checkpoint  # noqa: E402

  index_path = os.path.join(args.out, "index.json")
  old = json.load(open(index_path)) if os.path.exists(index_path) else {"models": [], "aliases": {}}
  found = {m["id"]: m for m in old["models"]}
  aliases = {k: dict(v) for k, v in old.get("aliases", {}).items()}
  hashes = {}  # (decks, sha of every player count's weights) -> id, to find duplicates
  for mid, _, _ in CATALOG:  # (already exported models, for alias detection)
    for d, ns in (found.get(mid) or {}).get("decks", {}).items():
      if mid not in aliases or d not in aliases[mid]:
        h = hashlib.sha1()
        for n in ns:
          h.update(open(os.path.join(args.out, mid, f"D{d}", f"N{n}.bin"), "rb").read())
        hashes[(int(d), tuple(ns), h.hexdigest())] = mid

  # (Champion last, so it becomes the alias of the model it is, not the reverse.)
  for mid, name, sources in sorted(CATALOG, key=lambda e: e[0] == "champion"):
    if args.ids and mid not in args.ids:
      continue
    entry = {"id": mid, "name": name, "decks": {}}
    for d, tmpl in sources.items():
      outs = {}
      for n in PLAYERS[d]:
        path = os.path.join(args.app, "models", tmpl.format(n=n))
        if os.path.exists(path):
          outs[n] = export(path, tmpl.format(n=n), G, M, load_checkpoint)
      if not outs:
        continue
      ns = sorted(outs)
      h = hashlib.sha1()
      for n in ns:
        h.update(outs[n][1])
      key = (d, tuple(ns), h.hexdigest())
      target = os.path.join(args.out, mid, f"D{d}")
      shutil.rmtree(target, ignore_errors=True)
      if key in hashes and hashes[key] != mid:  # same weights as another model
        aliases.setdefault(mid, {})[str(d)] = hashes[key]
        print(f"{name} (D{d}): same as {hashes[key]} -> alias")
      else:
        aliases.get(mid, {}).pop(str(d), None)
        os.makedirs(target, exist_ok=True)
        for n, (meta, blob) in outs.items():
          with open(os.path.join(target, f"N{n}.bin"), "wb") as f:
            f.write(blob)
          with open(os.path.join(target, f"N{n}.json"), "w") as f:
            json.dump(meta, f, indent=1)
        hashes[key] = mid
        print(f"{name} (D{d}): players {ns}, {sum(len(b) for _, b in outs.values()) / 1e6:.1f} MB")
      entry["decks"][str(d)] = ns
    if entry["decks"]:
      found[mid] = entry
  order = [mid for mid, _, _ in CATALOG]
  index = {"models": [found[m] for m in order if m in found],
           "aliases": {k: v for k, v in aliases.items() if v}}
  os.makedirs(args.out, exist_ok=True)
  with open(index_path, "w") as f:
    json.dump(index, f, indent=1)
  print(f"wrote {index_path}: {[m['id'] for m in index['models']]}, aliases {index['aliases']}")


if __name__ == "__main__":
  main()
