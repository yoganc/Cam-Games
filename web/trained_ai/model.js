// the trained Oh Hell policy networks in plain JS: the input features of
// oh_hell_harness/ohh/game.py (EngineeredEncoder, MultiDeckEncoder) and
// ohh/match.py (MatchEncoder, BehaviorEncoder), and the policy MLP of
// ohh/model.py (ActorCritic), loaded from export_models.py's files.
//
// Cards use the harness's ids: card = rank * 4 + suit, rank 0 = deuce .. 12 = ace
// (a double deck has two copies of each id). Actions: cards 0..51, then bid
// b = bid_action_offset + b.
const fs = require('fs');
const path = require('path');

const MODEL_DIR = path.join(__dirname, 'models');
const cache = {};

const suitOf = c => c % 4;
const rankOf = c => Math.floor(c / 4);

// Orders cards within a trick: trumps > lead suit > everything else.
function strength(c, leadSuit, trumpSuit) {
    const s = suitOf(c), r = rankOf(c);
    return s == trumpSuit ? 200 + r : s == leadSuit ? 100 + r : r;
}

// ohh/game.py trick_winner: [player, card] taking `trick` so far (card null if
// no card can win: the leader takes it). Identical cards (double deck) cancel
// each other; then trumps beat the led suit; other suits can't win.
function trickWinner(trick, trumpSuit) {
    const lead = suitOf(trick[0][1]);
    let best = -1, winner = [trick[0][0], null];
    for (const [q, c] of trick) {
        if (trick.filter(([, x]) => x == c).length > 1) continue;
        const s = suitOf(c);
        let key = s == trumpSuit ? 200 : s == lead ? 100 : -1;
        if (key < 0) continue;
        key += rankOf(c);
        if (key > best) { best = key; winner = [q, c]; }
    }
    return winner;
}

// numpy's searchsorted(edges, v, side="right"): how many edges are <= v.
const bucket = (edges, v) => edges.filter(e => e <= v).length;

// numpy's float64 sum (pairwise summation), so means match np.mean exactly.
function pairwiseSum(a) {
    const n = a.length;
    if (n < 8) {
        let r = 0;
        for (const v of a) r += v;
        return r;
    }
    if (n <= 128) {
        const r = a.slice(0, 8);
        let i = 8;
        for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[i + j];
        let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        for (; i < n; i++) res += a[i];
        return res;
    }
    let n2 = Math.floor(n / 2);
    n2 -= n2 % 8;
    return pairwiseSum(a.slice(0, n2)) + pairwiseSum(a.slice(n2));
}
const mean = a => pairwiseSum(a) / a.length;

// The deal as the acting player sees it.
// s: {me, dealer, numTricks, trump, hand: [card] (repeats = copies),
//     bids: [-1 = none], won: [tricks], tricks: [[[player, card], ...] in play
//     order, ...] (this deal's completed tricks, then the one in progress),
//     match (match models): {dealIndex, totals: [before this deal],
//     history: [[hand size, dealer, bids, won], ...] (earlier deals)}}
function dealParts(s, n) {
    const last = s.tricks.length ? s.tricks[s.tricks.length - 1] : null;
    const trick = last && last.length < n ? last : [];
    const done = s.tricks.length - (trick.length ? 1 : 0);
    const seen = [];
    for (const t of s.tricks) for (const [, c] of t) seen.push(c);
    return { trick, done, seen };
}

// Features shared by both deal encoders (bids, tricks won, need, pressure, voids).
function encodeBidsAndVoids(x, o, s, n, T, S, rel) {
    let made = 0, anyMade = false;
    for (let q = 0; q < n; q++) {
        const r = rel(q), b = s.bids[q], w = s.won[q];
        x[o.bids + r * (T + 2) + b + 1] = 1;
        x[o.won + r * (T + 1) + w] = 1;
        if (b >= 0) {
            x[o.need + r * (2 * T + 1) + T + b - w] = 1;
            made += b;
            anyMade = true;
        }
    }
    if (anyMade) x[o.bid_pressure + T + Math.max(-T, Math.min(T, made - s.numTricks))] = 1;
    for (const t of s.tricks) {
        const lead = suitOf(t[0][1]);
        for (const [q, c] of t.slice(1)) if (suitOf(c) != lead) x[o.voids + rel(q) * S + lead] = 1;
    }
}

// ohh/game.py EngineeredEncoder (single deck).
function encodeEngineered(x, meta, s) {
    const L = meta.layout, o = meta.feature_offsets;
    const n = L.num_players, d = L.deck_size, T = L.max_tricks, S = L.num_suits;
    const ranks = d / S, me = s.me;
    const rel = q => ((q - me) % n + n) % n;
    const trump = suitOf(s.trump);
    const { trick, done, seen } = dealParts(s, n);

    x[o.seat_vs_dealer + ((me - s.dealer) % n + n) % n] = 1;
    x[o.bidding] = s.bids[me] < 0 ? 1 : 0;
    x[o.num_tricks + s.numTricks - 1] = 1;
    x[o.tricks_left + s.numTricks - done] = 1;
    x[o.trump_suit + trump] = 1;
    x[o.trump_card + s.trump] = 1;
    for (const c of s.hand) x[o.hand + c] = 1;
    for (const c of seen) x[o.seen + c] = 1;

    const known = new Set(s.hand.concat(seen, [s.trump]));
    const handLen = [0, 0, 0, 0], unseenLen = [0, 0, 0, 0], topUnseen = [-1, -1, -1, -1];
    for (const c of s.hand) handLen[suitOf(c)]++;
    for (let c = 0; c < d; c++) {
        if (!known.has(c)) {
            unseenLen[suitOf(c)]++;
            topUnseen[suitOf(c)] = Math.max(topUnseen[suitOf(c)], rankOf(c));
        }
    }
    for (let su = 0; su < S; su++) {  // thermometers
        for (let k = 0; k < handLen[su]; k++) x[o.hand_suit_len + su * ranks + k] = 1;
        for (let k = 0; k < unseenLen[su]; k++) x[o.unseen_suit_len + su * ranks + k] = 1;
    }

    if (trick.length) {
        const lead = suitOf(trick[0][1]);
        x[o.lead_suit + lead] = 1;
        for (const [q, c] of trick) x[o.trick_cards + (rel(q) - 1) * d + c] = 1;
        let [wq, wc] = trick[0];
        for (const [q, c] of trick) {
            if (strength(c, lead, trump) > strength(wc, lead, trump)) { wq = q; wc = c; }
        }
        x[o.winning_card + wc] = 1;
        x[o.winning_seat + rel(wq)] = 1;
        const best = strength(wc, lead, trump);
        for (const c of s.hand) if (strength(c, lead, trump) > best) x[o.wins_now + c] = 1;
    } else if (s.bids[me] >= 0) {
        x[o.leading] = 1;
    }
    encodeBidsAndVoids(x, o, s, n, T, S, rel);
    for (const c of s.hand) if (rankOf(c) > topUnseen[suitOf(c)]) x[o.boss + c] = 1;
}

// ohh/game.py MultiDeckEncoder (copies of each card; identical cards cancel).
function encodeMultiDeck(x, meta, s) {
    const L = meta.layout, o = meta.feature_offsets;
    const n = L.num_players, d = L.deck_size, T = L.max_tricks, S = L.num_suits;
    const D = L.copies, ranks = d / S, me = s.me;
    const rel = q => ((q - me) % n + n) % n;
    const trump = suitOf(s.trump);
    const { trick, done, seen } = dealParts(s, n);

    x[o.seat_vs_dealer + ((me - s.dealer) % n + n) % n] = 1;
    x[o.bidding] = s.bids[me] < 0 ? 1 : 0;
    x[o.num_tricks + s.numTricks - 1] = 1;
    x[o.tricks_left + s.numTricks - done] = 1;
    x[o.trump_suit + trump] = 1;
    x[o.trump_card + s.trump] = 1;
    const hand = new Array(d).fill(0), seenN = new Array(d).fill(0);
    for (const c of s.hand) hand[c]++;
    for (const c of seen) seenN[c]++;
    const unseen = hand.map((h, c) => D - h - seenN[c]);
    unseen[s.trump] -= 1;
    for (let c = 0; c < d; c++) {  // thermometers over copies
        for (let k = 0; k < hand[c]; k++) x[o.hand + c * D + k] = 1;
        for (let k = 0; k < seenN[c]; k++) x[o.seen + c * D + k] = 1;
        for (let k = 0; k < unseen[c]; k++) x[o.unseen + c * D + k] = 1;
    }
    for (let su = 0; su < S; su++) {
        let hs = 0, us = 0;
        for (let c = su; c < d; c += S) { hs += hand[c]; us += unseen[c]; }
        for (let k = 0; k < Math.min(hs, T); k++) x[o.hand_suit_len + su * T + k] = 1;
        for (let k = 0; k < us; k++) x[o.unseen_suit_len + su * ranks * D + k] = 1;
    }
    const handSet = [...new Set(s.hand)];
    if (trick.length) {
        const lead = suitOf(trick[0][1]);
        x[o.lead_suit + lead] = 1;
        for (const [q, c] of trick) {
            x[o.trick_cards + (rel(q) - 1) * d + c] = 1;
            if (trick.filter(([, y]) => y == c).length > 1) x[o.cancelled + c] = 1;
        }
        const [wq, wc] = trickWinner(trick, trump);
        if (wc !== null) x[o.winning_card + wc] = 1;
        x[o.winning_seat + rel(wq)] = 1;
        for (const c of handSet) {
            if (trickWinner(trick.concat([[me, c]]), trump)[0] == me) x[o.wins_now + c] = 1;
            if (wc !== null && c == wc) x[o.cancels_winner + c] = 1;
        }
    } else if (s.bids[me] >= 0) {
        x[o.leading] = 1;
    }
    encodeBidsAndVoids(x, o, s, n, T, S, rel);
    const topUnseen = [-1, -1, -1, -1];
    for (let c = 0; c < d; c++) {
        if (unseen[c] > 0) topUnseen[suitOf(c)] = Math.max(topUnseen[suitOf(c)], rankOf(c));
    }
    for (const c of handSet) {
        if (rankOf(c) >= topUnseen[suitOf(c)]) x[(unseen[c] == 0 ? o.boss : o.boss_but_copy) + c] = 1;
    }
}

// ohh/match.py MatchEncoder: deal index, score gaps to each opponent and the leader.
function encodeMatch(x, mm, s, n, o) {
    const ctx = s.match;
    x[o + ctx.dealIndex] = 1;
    o += mm.num_deals;
    const me = s.me, totals = ctx.totals;
    const others = [];
    for (let r = 1; r < n; r++) others.push((me + r) % n);
    const gaps = others.map(q => totals[me] - totals[q]);
    gaps.push(totals[me] - Math.max(...others.map(q => totals[q])));
    const bins = mm.gap_edges.length + 1;
    gaps.forEach((g, i) => { x[o + i * bins + bucket(mm.gap_edges, g)] = 1; });
    return o + n * bins;
}

// ohh/match.py BehaviorEncoder: each opponent's tendencies in this match so far.
function encodeBehavior(x, mm, s, n, o) {
    const hist = s.match.history, b = mm.behavior;
    const sizes = [b.exact_edges.length + 2, b.bias_edges.length + 2, b.level_edges.length + 2, 4];
    for (let r = 1; r < n; r++) {
        const q = (s.me + r) % n;
        let idx = [0, 0, 0, 0];  // no data yet
        if (hist.length) {
            const bids = hist.map(h => h[2][q]), won = hist.map(h => h[3][q]);
            const size = hist.map(h => h[0]);
            const last = bids[bids.length - 1] - won[won.length - 1];
            idx = [1 + bucket(b.exact_edges, mean(bids.map((v, k) => v == won[k] ? 1 : 0))),
                   1 + bucket(b.bias_edges, mean(bids.map((v, k) => v - won[k]))),
                   1 + bucket(b.level_edges, mean(bids.map((v, k) => v * n / size[k]))),
                   1 + (last == 0 ? 0 : last > 0 ? 1 : 2)];
        }
        sizes.forEach((sz, k) => { x[o + idx[k]] = 1; o += sz; });
    }
    return o;
}

class TrainedModel {
    constructor(meta, buffer) {
        this.meta = meta;
        this.L = meta.layout;
        const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        this.layers = meta.layers.map(l => ({
            rows: l.rows, cols: l.cols, relu: l.relu,
            w: new Float32Array(ab, l.w, l.rows * l.cols),
            b: new Float32Array(ab, l.b, l.rows),
        }));
    }

    encode(s) {
        const meta = this.meta;
        const x = new Float64Array(meta.obs_size);
        if (meta.features == 'multideck') encodeMultiDeck(x, meta, s);
        else if (meta.features == 'engineered') encodeEngineered(x, meta, s);
        else throw new Error(`unsupported features ${meta.features}`);
        if (meta.match) {
            let o = encodeMatch(x, meta.match, s, this.L.num_players, meta.deal_obs_size);
            if (meta.match.behavior) o = encodeBehavior(x, meta.match, s, this.L.num_players, o);
        }
        return x;
    }

    logits(x) {
        let h = x;
        for (const l of this.layers) {
            const y = new Float64Array(l.rows);
            for (let i = 0; i < l.rows; i++) {
                let acc = l.b[i];
                const row = i * l.cols;
                for (let j = 0; j < l.cols; j++) {
                    if (h[j] !== 0) acc += l.w[row + j] * h[j];
                }
                y[i] = l.relu && acc < 0 ? 0 : acc;
            }
            h = y;
        }
        return h;
    }

    // Greedy action among `legal` (action ids); ties go to the lowest id, like torch.argmax.
    act(s, legal) {
        const z = this.logits(this.encode(s));
        let best = -1;
        for (const a of [...new Set(legal)].sort((p, q) => p - q)) {
            if (best < 0 || z[a] > z[best]) best = a;
        }
        return best;
    }
}

// models/index.json: {models: [{id, name, decks: {"1": [3, ...], "2": [...]}}],
// aliases: {id: {decks: other id}}} (e.g. Champion = the Square Hand Player).
let index;
function catalog(dir = MODEL_DIR) {
    if (!index) {
        const f = path.join(dir, 'index.json');
        index = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { models: [], aliases: {} };
    }
    return index;
}

// Model ids offered for a table of N players and D decks (in catalog order).
function modelsFor(N, D) {
    return catalog().models.filter(m => (m.decks[D] || []).includes(N));
}

function modelName(id) {
    const m = catalog().models.find(m => m.id == id);
    return m ? m.name : id;
}

function loadModel(id, N, D = 1, dir = MODEL_DIR) {
    const alias = (catalog(dir).aliases[id] || {})[D];
    const real = alias || id;
    const key = `${dir}:${real}:${D}:${N}`;
    if (!(key in cache)) {
        const base = path.join(dir, real, `D${D}`, `N${N}`);
        cache[key] = fs.existsSync(base + '.json')
            ? new TrainedModel(JSON.parse(fs.readFileSync(base + '.json', 'utf8')),
                              fs.readFileSync(base + '.bin'))
            : undefined;
    }
    return cache[key];
}

module.exports = { TrainedModel, loadModel, modelsFor, modelName, catalog, strength, trickWinner,
                   suitOf, rankOf, pairwiseSum };
