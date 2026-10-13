// StrategyModuleTrained: an Oh Hell robot that plays with one of the trained
// trained models (trained_ai/model.js, chosen by catalog id: "champion",
// "sq_reader", ...) instead of the built-in AI.
//
// It wraps the built-in module for one seat (`base`, e.g. StrategyModuleOI):
// the base module still runs at every decision, so the post-game analysis
// (AI bid, making probabilities, mistakes, which the core expects for every
// player) works as before, and claims are answered by the base module. Only
// the bid or card actually sent comes from the trained model.
const { loadModel, modelsFor, modelName, catalog } = require('./model');

const DEFAULT_MODEL = 'champion';

// His cards (num 2..14, suit 0..3) <-> harness card ids (rank * 4 + suit).
const toId = card => (card.num - 2) * 4 + card.suit;

function supported(model, N, D, T) {
    return !T && loadModel(model || DEFAULT_MODEL, N, D) !== undefined;
}

// The match so far, as ohh/match.py MatchContext: this deal's index in the
// model's ladder, everyone's totals before this deal, and the earlier deals'
// (hand size, dealer, bids, tricks won). A different ladder is aligned by deals
// remaining, which matters most for end-of-match decisions.
function matchFromCore(core, numDeals) {
    const players = core.players.players;
    const r = core.roundNumber;
    const history = [];
    for (let j = 0; j < r; j++) {
        history.push([core.rounds[j].handSize, core.rounds[j].dealer,
                      players.map(p => p.bids[j]), players.map(p => p.takens[j])]);
    }
    let dealIndex = r;
    if (core.rounds.length != numDeals) {
        const remaining = core.rounds.length - 1 - r;
        dealIndex = Math.max(0, Math.min(numDeals - 1, numDeals - 1 - remaining));
    }
    return { dealIndex, totals: players.map(p => p.score), history };
}

// The acting player's view of the deal (and match), as model.js encode() expects it.
function stateFromCore(core, player, numDeals) {
    const players = core.players.players;
    const n = players.length;
    const r = core.leaders.length - 1;
    const tricks = [];
    core.leaders[r].forEach((leader, k) => {  // completed tricks
        const t = [];
        for (let i = 0; i < n; i++) {
            const j = (leader + i) % n;
            const plays = players[j].plays[players[j].plays.length - 1];
            t.push([j, toId(plays[k])]);
        }
        tricks.push(t);
    });
    const current = [];
    for (let i = 0; i < n; i++) {  // the trick in progress, from its leader
        const j = (core.leader + i) % n;
        if (!players[j].played) break;
        current.push([j, toId(players[j].trick)]);
    }
    if (current.length) tricks.push(current);
    return {
        me: player.index,
        dealer: core.getDealer(),
        numTricks: core.getHandSize(),
        trump: toId(core.getTrump()),
        hand: player.hand.map(toId),
        bids: players.map(p => p.bidded ? p.bid : -1),
        won: players.map(p => p.taken),
        tricks: tricks,
        match: numDeals ? matchFromCore(core, numDeals) : undefined,
    };
}

class StrategyModuleTrained {
    constructor(N, D, base, model = DEFAULT_MODEL) {
        this.N = N;
        this.D = D;
        this.base = base;
        this.modelId = model;
        this.model = loadModel(model, N, D);
        this.numDeals = this.model.meta.match ? this.model.meta.match.num_deals : 0;
        this.isTrained = true;
    }

    setCoreAndPlayer(core, player) {
        this.core = core;
        this.player = player;
        this.base.setCoreAndPlayer(core, player);
    }

    state() {
        return stateFromCore(this.core, this.player, this.numDeals);
    }

    legalBids() {
        const off = this.model.meta.bid_action_offset;
        const cannot = this.core.whatCanINotBid(this.player.index);
        const legal = [];
        for (let b = 0; b <= this.core.getHandSize(); b++) {
            if (b != cannot) legal.push(off + b);
        }
        return legal;
    }

    makeBid() {
        this.base.makeBid();  // analysis bookkeeping (and the built-in AI's bid)
        const a = this.model.act(this.state(), this.legalBids());
        return a - this.model.meta.bid_action_offset;
    }

    makePlay() {
        this.base.makePlay();  // analysis bookkeeping (making probabilities)
        const canPlay = this.core.whatCanIPlay(this.player.index);
        if (canPlay.length == 1) return canPlay[0];
        const a = this.model.act(this.state(), canPlay.map(toId));
        return canPlay.find(c => toId(c) == a);
    }

    makeDecision(data) {
        return this.base.makeDecision(data);
    }
}

module.exports = { StrategyModuleTrained, stateFromCore, matchFromCore, supported, toId,
                   modelsFor, modelName, catalog, DEFAULT_MODEL };
