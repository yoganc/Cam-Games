// Recomputes dump_states.py's decisions with trained_ai (state and match taken
// from a Games2-style core) and reports mismatches.
//   node tools/check_states.js /tmp/s.jsonl [more.jsonl ...]
const fs = require('fs');
const { loadModel } = require('../model');
const { stateFromCore, toId } = require('../strategy');

let featBad = 0, legalBad = 0, actBad = 0, maxErr = 0, count = 0;
const perModel = {};
for (const file of process.argv.slice(2)) {
    for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) {
        const d = JSON.parse(line);
        const m = loadModel(d.model, d.N, d.D);
        const c = d.core;
        const players = c.players;
        const core = {
            players: { players: players, size: () => players.length },
            leaders: c.leaders, leader: c.leader, roundNumber: c.roundNumber, rounds: c.rounds,
            getDealer: () => c.dealer, getHandSize: () => c.handSize, getTrump: () => c.trump,
            whatCanINotBid: i => i != c.dealer ? -1
                : c.handSize - players.filter(p => p.index != i && p.bidded).reduce((a, p) => a + p.bid, 0),
            whatCanIPlay: i => {
                const hand = players[i].hand;
                if (!players[c.leader].played) return hand;
                const led = players[c.leader].trick.suit;
                const follow = hand.filter(h => h.suit == led);
                return follow.length ? follow : hand;
            },
        };
        const me = players[c.me];
        const numDeals = m.meta.match ? m.meta.match.num_deals : 0;
        const s = stateFromCore(core, me, numDeals);
        const x = m.encode(s);
        const hot = [];
        x.forEach((v, i) => { if (v) hot.push(i); });
        const bad = { feat: 0, legal: 0, act: 0 };
        if (x.length != d.x_size || JSON.stringify(hot) != JSON.stringify(d.x)) {
            bad.feat = 1;
            if (featBad++ < 3) console.log('features differ', d.model, 'js', hot, 'py', d.x);
        }
        const bidding = !me.bidded;
        const legal = bidding ? (() => {
            const off = m.meta.bid_action_offset, no = core.whatCanINotBid(c.me), out = [];
            for (let b = 0; b <= c.handSize; b++) if (b != no) out.push(off + b);
            return out;
        })() : [...new Set(core.whatCanIPlay(c.me).map(toId))].sort((a, b) => a - b);
        if (JSON.stringify(legal) != JSON.stringify(d.legal)) {
            bad.legal = 1;
            if (legalBad++ < 3) console.log('legal differs', legal, d.legal);
        }
        const z = m.logits(x);
        d.legal.forEach((a, k) => { maxErr = Math.max(maxErr, Math.abs(z[a] - d.logits[k])); });
        if (m.act(s, d.legal) != d.action) {
            bad.act = 1;
            if (actBad++ < 3) console.log('action differs', d.model, m.act(s, d.legal), d.action);
        }
        const key = `${d.model} D${d.D} N${d.N}`;
        const pm = perModel[key] || (perModel[key] = [0, 0]);
        pm[0]++;
        if (bad.feat || bad.legal || bad.act) pm[1]++;
        count++;
    }
}
for (const [k, [n, b]] of Object.entries(perModel)) console.log(`  ${k}: ${n} decisions, ${b} differ`);
console.log(`${count} decisions: features differ ${featBad}, legal differ ${legalBad}, ` +
            `action differ ${actBad}, max |logit diff| ${maxErr.toExponential(2)}`);
process.exit(featBad + legalBad + actBad ? 1 : 0);
