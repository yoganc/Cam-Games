var debug = false;
var logFile = './logs/log.txt';

var ml = require('./ml');
var fs = require('fs');

var robotNames = fs.readFileSync('./misc/firstnames.txt', 'utf8').replace('\r', '').split('\n');

const _euchre = require('./build/Release/euchre');
const trainedAi = require('./trained_ai/strategy');

// shared utils
function log(msg, tabs) {
    if (debug) {
        while (tabs && tabs > 0) {
            msg = '    ' + msg;
            tabs--;
        }
        fs.writeFileSync(logFile, msg + '\n', {flag: 'a+'});
    }
}

function difficulty(qs) {
    let A = 0.45;
    let B = 0.025;
    let u = 0;

    let max = Math.max(...qs);
    let r = A - B * (qs.length - 1);
    let s = u == 0 ?
        Math.log(max) / Math.log(r) :
        (Math.pow(max, u) - 1) / (Math.pow(r, u) - 1);

    return Math.max(1, Math.min(10, 1 + 9 * s));
}

function points(k, l) {
    if (k == l) {
        return 10 + k * k;
    } else {
        let d = Math.abs(k - l);
        return -5 * d * (d + 1) / 2;
    }
}

function pointsMean(qs, bid) {
    return qs.reduce((qsum, q, i) => qsum + q * points(i, bid), 0);
}

function pointsVariance(qs, bid) {
    return qs.reduce((qsum, q, i) => qsum + q * Math.pow(points(i, bid), 2), 0) - Math.pow(pointsMean(qs, bid), 2);
}

function clip(x, min, max) {
    return Math.min(Math.max(x, min), max);
}

function array(dims, fill) {
    let arr = new Array(dims[0]).fill(fill);
    if (dims.length == 1) {
        return arr;
    } else {
        return arr.map(sub => array(dims.slice(1), fill));
    }
}

// encode card with parity (0 or 1)
function encodeCP(card, eps) {
    return card.toNumber() * (1 - 2 * eps) - eps;
}

class Partition {
    constructor(length, sum) {
        this.values = new Array(length - 1).fill(0);
        this.sum = sum;
        this.partial = 0;
        this.end = false;
    }

    getValue(index) {
        return index < this.values.length ? this.values[index] : this.sum - this.partial;
    }

    increment() {
        if (this.values.length == 0 || this.sum == 0) {
            this.end = true;
        } else if (this.partial < this.sum) {
            this.partial++;
            this.values[0]++;
        } else {
            let i = 0;
            for (; i < this.values.length && this.values[i] == 0; i++);
            this.partial -= this.values[i];
            this.values[i] = 0;
            if (i < this.values.length - 1) {
                this.partial++;
                this.values[i + 1]++;
            } else {
                this.end = true;
            }
        }
    }

    isEnd() {
        return this.end;
    }

    toString() {
        return '[' + this.values.map(v => v).concat([this.sum - this.partial]) + ']';
    }
}

// dumb ------------------------------------------------------------------------
class StrategyModuleDumb {
    constructor() {}

    setCoreAndPlayer(core, player) {
        this.core = core;
        this.player = player;
    }

    makeBid() {
        let cannotBid = this.core.whatCanINotBid(this.player.index);
        let bid = 0;
        do {
            bid = Math.floor(Math.random() * (this.player.hand.length + 1));
        } while (bid == cannotBid);

        let qs = new Array(this.player.hand.length).fill(0);
        this.player.addQs(this.core.roundNumber, qs);
        this.player.addDiff(this.core.roundNumber, 0);
        this.player.addAiBid(this.core.roundNumber, 0);

        return bid;
    }

    makePass() {
        let count = this.core.howManyToPass();
        let handCopy = this.player.hand.map(c => c);
        let pass = [];
        for (let i = 0; i < count; i++) {
            let card = handCopy.splice(Math.floor(Math.random() * handCopy.length), 1)[0];
            pass.push(card);
        }

        return pass;
    }

    makePlay() {
        let canPlay = this.core.whatCanIPlay(this.player.index);

        let fullProbs = this.player.hand.map(c => [c, -1]);
        this.player.addMakingProbs(this.core.getHandSize() - this.player.hand.length, fullProbs);

        return canPlay[Math.floor(Math.random() * canPlay.length)];
    }

    makeDecision(data) {
        let choice = {
            name: data.name,
            choice: Math.floor(Math.random() * data.choices.length)
        }

        return choice;
    }
}

// oi --------------------------------------------------------------------------
class StrategyModuleOI {
    constructor(N, D, ovl, ivl) {
        this.N = N;
        this.D = D;
        this.maxH = Math.min(10, Math.floor((52 * D - 1) / N));
        this.maxCancels = D == 1 ? 0 : Math.floor((N - 1) / 2);
        this.ovl = ovl;
        this.ivl = ivl;
    }

    setCoreAndPlayer(core, player) {
        this.core = core;
        this.player = player;
    }

    makeBid() {
        log(`${this.player.name} bid----------------------------------`);

        this.loadSlowFeatures();

        let qs = this.getQs(this.player.hand.length);
        this.player.addQs(this.core.roundNumber, qs);
        this.player.addDiff(this.core.roundNumber, difficulty(qs));

        let myBid = this.chooseBid(qs);
        this.player.addAiBid(this.core.roundNumber, myBid);

        log(`qs=[${qs}]`);
        log(`bid=${myBid}`);

        return myBid;
    }

    makePlay() {
        log(`${this.player.name} play---------------------------------`);

        let myPlay = undefined;

        let makingProbs = this.getMakingProbs();

        let fullProbs = [];
        let pointer = 0;
        for (const c of this.player.hand) {
            if (pointer < makingProbs.length && c.matches(makingProbs[pointer][0])) {
                fullProbs.push(makingProbs[pointer]);
                pointer++;
            } else {
                fullProbs.push([c, -1]);
            }
        }
        this.player.addMakingProbs(this.core.getHandSize() - this.player.hand.length, fullProbs);

        if (this.player.hand.length == 1) {
            myPlay = this.player.hand[0];
        } else {
            myPlay = this.choosePlay(makingProbs);
        }

        return myPlay;

        //let canPlay = this.core.whatCanIPlay(this.player.index);
        //return canPlay[Math.floor(Math.random() * canPlay.length)];
    }

    makeDecision(data) {
        if (data.name == 'claim') {
            let accept = this.core.hasColdClaim(data.data.index);

            return {
                name: 'claim',
                choice: accept ? 0 : 1
            }
        }
    }

    getMakingProbs() {
        this.loadSlowFeatures();
        this.canPlay = this.core.whatCanIPlay(this.player.index);

        log(`want=${this.wants[this.player.index]} teamwants=${this.core.teamWants(this.player.team)}`);

        let ans = [];
        for (const card of this.canPlay) {
            ans.push([card, this.prMakingIfPlayCard(card)]);
        }
        return ans;
    }

    prMakingIfPlayCard(card) {
        log(`consider play ${card.toString()}`);

        let requiredCancels = this.core.cancelsRequired(this.player.index, card)[this.player.index];

        let w = this.wants[this.player.index];

        let prIWin = this.prIWinTrick(card, requiredCancels);
        log(`prIWin=${prIWin}`);
        let qs = this.getQs(w, card);
        log(`qs=${qs}`);

        let prMakingIfIWin = w == 0 ? 0 : qs[w - 1];
        let prMakingIfILose = w == this.player.hand.length ? 0 : qs[w];

        let ans = prIWin * prMakingIfIWin + (1 - prIWin) * prMakingIfILose;
        log(`prob=${ans}`);

        return ans;
    }

    prIWinTrick(card, requiredCancels) {
        if (requiredCancels < 0) {
            return 0;
        }

        return this.ivl.evaluate(this.getIvl(card, requiredCancels)).get(0);
    }

    loadSlowFeatures() {
        let myHand = this.player.hand;

        this.seen = this.core.getHandCollection(this.player.index);
        //this.seen.merge(this.core.getTrickCollection());
        this.seen.merge(this.core.getSeenCollection());

        this.suitCounts = [0, 0, 0, 0];
        for (const card of myHand) {
            this.suitCounts[card.suit]++;
        }
        this.voidCount = 0;
        for (let count of this.suitCounts) {
            if (count == 0) {
                this.voidCount++;
            }
        }

        this.ovlMemo = {};

        this.wants = new Array(this.N);
        for (let i = 0; i < this.N; i++) {
            this.wants[i] = this.core.wants(i);
        }
    }

    getQs(max, card) {
        let ps = this.getPs(card);
        return this.subsetProb(ps, max);
    }

    getPs(card) {
        let h = this.player.hand.length;
        if (card !== undefined) {
            h--;
        }
        let ps = new Array(h);
        let i = 0;
        for (const c of this.player.hand) {
            if (c === card) {
                continue;
            }
            ps[i] = this.getP(c, card);
            i++;
        }

        return ps;
    }

    getP(card, myCard) {
        let voidInc = (myCard !== undefined && this.suitCounts[myCard.suit] == 1) ? 1 : 0;
        let code = encodeCP(card, voidInc);
        if (this.ovlMemo[code] === undefined) {
            this.ovlMemo[code] = this.ovl.evaluate(this.getOvl(card, myCard)).get(0);
        }
        return this.ovlMemo[code];
    }

    subsetProb(ps, l) {
        let qs = new Array(ps.length + 1).fill(0);
        qs[0] = 1;
        for (let i = 0; i < ps.length; i++) {
            let prev = 0;
            for (let j = 0; j <= i + 1 && j <= l; j++) {
                let next = qs[j];
                qs[j] = prev * ps[i] + next * (1 - ps[i]);
                prev = next;
            }
        }
        return qs;
    }

    chooseBid(qs) {
        // Comments copied from Java
        let bids = this.orderDesiredBids(qs);

        // Find the top choice bid that will not make the team overbid or force the dealer to
        // overbid if the dealer is on the team (note to self (TODO) -- this dealer thing may not
        // be necessary in all cases. Maybe we could want to bid to the max even if the dealer is
        // on our team because we think the other team will bid in between?).
        let maxBid = this.core.highestMakeableBid(this.player.index, true);

        let choice = 0;
        while (bids[choice] > maxBid) {
            choice++;
        }

        // If we can't bid that, then move one further
        if (bids[choice] == this.core.whatCanINotBid(this.player.index)) {
            choice++;
        }

        if (choice < bids.length) {
            return bids[choice];
        } else {
            // I think this can happen only when (1) bidding 0 was our last choice, (2) we
            // couldn't bid it because we're the dealer, and (3) all other teams bid 0, and (4)
            // someone on our team fucked us. Extremely unlikely scenario. Bid 1.
            return 1;
        }
    }

    orderDesiredBids(qs) {
        let n = qs.length - 1;

        let bidEPairs = new Array(n + 1);

        // my magical linear time algorithm
        for (let k = 0; k <= 1; k++) {
            bidEPairs[k] = [k, 0]
            for (let l = 0; l <= n; l++) {
                bidEPairs[k][1] += qs[l] * this.core.scoreFunc(k, l);
            }
        }

        for (let k = 2; k <= n; k++) {
            bidEPairs[k] = [
                k,
                bidEPairs[k - 1][1] * 2
                    - bidEPairs[k - 2][1]
                    - 5
                    + qs[k - 2] * (14 - 4 * k + k * k)
                    + qs[k - 1] * (-27 + 4 * k - 2 * k * k)
                    + qs[k] * (10 + k * k)
            ];
        }

        bidEPairs.sort((pair1, pair2) => Math.sign(pair2[1] - pair1[1]));
        return bidEPairs.map(pair => pair[0]);
    }

    choosePlay(probs) {
        let bestProb = -1;
        let bestPlays = [];

        for (const pair of probs) {
            if (pair[1] > bestProb) {
                bestProb = pair[1];
                bestPlays = [];
            }
            if (pair[1] == bestProb) {
                bestPlays.push(pair[0]);
            }
        }

        return bestPlays[Math.floor(Math.random() * bestPlays.length)];
    }

    getOvl(card, myCard) {
        let vec = new ml.SparseVector();

        // this was my old system -- min values are weird
        vec.addOneHot('Current hand size', this.player.hand.length - (myCard === undefined ? 0 : 1), 0, this.maxH);
        for (let i = 0; i < this.N; i++) {
            let j = (this.player.index + i) % this.N;
            vec.addOneHot(i + ' Bid', this.wants[j], -1, this.maxH);
        }
        vec.addOneHot('Void count', this.voidCount + (myCard !== undefined && this.suitCounts[myCard.suit] == 1 ? 1 : 0), -1, 3);
        vec.addOneHot('Trump unseen', this.seen.cardsLeftOfSuit(this.core.getTrump().suit), -1, 13 * this.D - 1);
        vec.addOneHot('Card is trump', card.suit == this.core.getTrump().suit ? 1 : 0, -1, 1);
        vec.addOneHot('Card\'s suit unseen', this.seen.cardsLeftOfSuit(card.suit), -1, 13 * this.D - 1);
        vec.addOneHot('Card\'s adjusted number', this.seen.cardValue(card), 0, 13 * this.D);
        vec.addOneHot('Card\'s matches unseen', this.seen.matchesLeft(card), 0, this.D - 1);

        return vec;
    }

    getIvl(card, requiredCancels) {
        let vec = new ml.SparseVector();

        let lead = this.player.index == this.core.getLeader() ? card : this.core.getLead();

        for (let i = 1; i < this.N; i++) {
            let j = (this.player.index + i) % this.N;
            let val = (this.player.index - this.core.getLeader() + this.N) % this.N + i < this.N ? this.wants[j] : -1;
            vec.addOneHot(i + ' Bid', val, -1, this.maxH);
        }
        vec.addOneHot('Trump unseen', this.seen.cardsLeftOfSuit(this.core.getTrump().suit), -1, 13 * this.D - 1);
        vec.addOneHot('Lead is trump', lead.suit == this.core.getTrump().suit ? 1 : 0, -1, 1);
        vec.addOneHot('Led suit unseen', this.seen.cardsLeftOfSuit(lead.suit), -1, 13 * this.D - 1);
        vec.addOneHot('Card is trump', card.suit == this.core.getTrump().suit ? 1 : 0, -1, 1);
        vec.addOneHot('Card\'s adjusted number', this.seen.cardValue(card), 0, 13 * this.D);
        vec.addOneHot('Card\'s matches unseen', this.seen.matchesLeft(card), 0, this.D - 1);
        vec.addOneHot('Required cancels', requiredCancels, 0, this.maxCancels);

        return vec;
    }
}

class StrategyModuleOITeam {
    constructor(N, D, T, ovl, ivl, ttl) {
        this.N = N;
        this.D = D;
        this.T = T;
        this.maxH = Math.min(10, Math.floor((52 * D - 1) / N));
        this.maxCancels = Math.floor((N - 1) / 2);
        this.ovl = ovl;
        this.ivl = ivl;
        this.ttl = ttl;

        this.logDepth = 0;
    }

    setCoreAndPlayer(core, player) {
        this.core = core;
        this.player = player;
    }

    makeBid() {
        //debug = this.core.getHandSize() == 9;
        log(`${this.player.index} (${this.player.name}) bidding {`, this.logDepth);
        this.logDepth++;

        this.loadSlowFeatures(true);
        this.clearQsMemo();

        let myTeamMembers = this.myTeam.members.filter(p => p.bidded || p === this.player);

        let h = this.player.hand.length;
        let qsTotal = new Array(h + 1).fill(0);
        for (let b = 0; b <= h; b++) {
            for (let part = new Partition(myTeamMembers.length, b); !part.isEnd(); part.increment()) {
                let term = 1;
                for (let i = 0; i < myTeamMembers.length; i++) {
                    term *= this.prPlayerTakesExactly(myTeamMembers[i].index, part.getValue(i), h, undefined, this.core.players.nextUnkicked(this.core.getDealer()));
                }
                qsTotal[b] += term;
            }
        }

        this.player.addQs(this.core.roundNumber, qsTotal);
        this.player.addDiff(this.core.roundNumber, difficulty(qsTotal));

        let myBid = this.chooseBid(qsTotal) - this.teamWantsBeforePlay;
        this.player.addAiBid(this.core.roundNumber, myBid);

        log(`Bidding ${myBid}`, this.logDepth);
        this.logDepth--;
        log(`}`, this.logDepth);

        return myBid;
    }

    makePlay() {
        log(`${this.player.index} (${this.player.name}) playing {`, this.logDepth);
        this.logDepth++;

        let myPlay = undefined;

        let makingProbs = this.getMakingProbs();

        let fullProbs = [];
        let pointer = 0;
        for (const c of this.player.hand) {
            if (pointer < makingProbs.length && c.matches(makingProbs[pointer][0])) {
                fullProbs.push(makingProbs[pointer]);
                pointer++;
            } else {
                fullProbs.push([c, -1]);
            }
        }
        this.player.addMakingProbs(this.core.getHandSize() - this.player.hand.length, fullProbs);

        if (this.player.hand.length == 1) {
            myPlay = this.player.hand[0];
        } else {
            myPlay = this.choosePlay(makingProbs);
        }

        log(`Playing ${myPlay.toString()}`, this.logDepth);
        this.logDepth--;
        log(`}`, this.logDepth);

        return myPlay;
    }

    makeDecision(data) {
        if (data.name == 'claim') {
            let accept = this.core.hasColdClaim(data.data.index);

            return {
                name: 'claim',
                choice: accept ? 0 : 1
            }
        }
    }

    getMakingProbs() {
        this.loadSlowFeatures(false);

        let ans = [];
        for (const card of this.canPlay) {
            log(`Analyzing play ${card.toString()} {`, this.logDepth);
            this.logDepth++;
            let p = this.prMakingIfPlayCard(card);
            ans.push([card, p]);
            log(`Making probability: ${p}`, this.logDepth);
            this.logDepth--;
            log(`}`, this.logDepth);
        }
        return ans;
    }

    prMakingIfPlayCard(card) {
        let sum = 0;

        let requiredCancels = this.core.cancelsRequired(this.player.index, card);

        let p1s = this.prPlayersWinTrick(card, requiredCancels);
        if (debug) {
            log(`ivl {`, this.logDepth);
            this.logDepth++;
            for (let i = 0; i < p1s.length; i++) {
                let player = this.core.players.players[i];
                let trick = i == this.player.index ? card : player.trick;
                log(`${i} (${player.name}), ${trick.toString()}, ${p1s[i]}, ${requiredCancels[i]}`, this.logDepth);
            }
            this.logDepth--;
            log('}', this.logDepth);
        }

        for (let i = 0; i < this.N; i++) {
            log(`Analyzing ${i} (${this.core.players.players[i].name}) wins {`, this.logDepth);
            this.logDepth++;
            let p1 = requiredCancels[i] == -2 ? 0 : p1s[i];
            let p2 = this.prMakingIfPlayerWinsTrick(card, i);
            sum += p1 * p2;
            log(`Making probability: ${p2}`, this.logDepth);
            this.logDepth--;
            log(`}`, this.logDepth);
        }

        return sum;
    }

    prPlayersWinTrick(card, requiredCancels) {
        return this.ivl.evaluate(this.getIvl(card, requiredCancels)).toArray();
    }

    prMakingIfPlayerWinsTrick(card, index) {
        let myTeamMembers = this.myTeam.members;
        let onMyTeam = this.core.players.players[index].team == this.player.team;
        let teamWants = Math.max(this.teamWantsBeforePlay - (onMyTeam ? 1 : 0), 0);

        this.clearQsMemo();

        // Iterate through all combinations of takens that add to wants
        let p = 0;
        let probMemo = array([myTeamMembers.length, teamWants + 1], undefined);
        for (let part = new Partition(myTeamMembers.length, teamWants); !part.isEnd(); part.increment()) {
            let term = 1;
            for (let i = 0; i < myTeamMembers.length; i++) {
                let toTake = part.getValue(i);
                if (probMemo[i][toTake] === undefined) {
                    probMemo[i][toTake] = this.prPlayerTakesExactly(myTeamMembers[i].index, toTake, teamWants, card, index);
                }
                term *= probMemo[i][toTake];
            }
            p += term;
        }

        return onMyTeam && this.teamWantsBeforePlay == 0 ? 0 : p;
    }

    prPlayerTakesExactly(index, toTake, maxForMemo, card, prevIndex) {
        if (this.teamQsMemo[index] === undefined) {
            if (index == this.player.index) {
                this.teamQsMemo[index] = this.getQs(maxForMemo, card, prevIndex);
            } else {
                this.teamQsMemo[index] = this.ttl.evaluate(this.getTtl(index, card, prevIndex)).toArray();

                if (debug) {
                    log(`ttl ${index} (${this.core.players.players[index].name}) {`, this.logDepth);
                    this.logDepth++;
                    for (let i = 0; i < this.teamQsMemo[index].length; i++) {
                        log(`${i}, ${this.teamQsMemo[index][i]}`, this.logDepth);
                    }
                    this.logDepth--;
                    log('}', this.logDepth);
                }
            }
        }
        return this.teamQsMemo[index][toTake];
    }

    loadSlowFeatures(biddingOnly) {
        let myHand = this.player.hand;

        this.myTeam = this.core.players.teams[this.player.team];
        this.teamWantsBeforePlay = clip(this.myTeam.bid() - this.myTeam.taken(), 0, myHand.length);

        this.seen = this.core.getHandCollection(this.player.index);
        this.seen.merge(this.core.getSeenCollection());

        this.teamWant = new Array(this.N);
        for (let i = 0; i < this.N; i++) {
            this.teamWant[i] = this.core.teamWants(this.core.players.players[i].team);
        }

        this.suitCounts = [0, 0, 0, 0];
        for (const card of myHand) {
            this.suitCounts[card.suit]++;
        }
        this.voidCount = 0;
        for (let count of this.suitCounts) {
            if (count == 0) {
                this.voidCount++;
            }
        }

        this.handAdjustedNumbers = {};
        this.handMatchesUnseen = {};
        for (const card of myHand) {
            this.handAdjustedNumbers[card.toNumber()] = this.seen.cardValue(card);
            this.handMatchesUnseen[card.toNumber()] = this.seen.matchesLeft(card);
        }

        this.ovlMemo = new Array(this.N).fill(0).map(x => new Object());
        this.teamOvls = array([this.N, this.maxH], undefined);

        // we don't really need to compute this every time
        this.realIndex = new Array(this.core.players.teams.length).fill(-1);
        let ind = 0;
        for (const team of this.core.players.teams) {
            if (team.members.length > 0) {
                this.realIndex[team.number] = ind;
                ind++;
            }
        }

        for (const p of this.myTeam.members) {
            let voidApprox = [0, 1, 2, 3].filter(s => p.voidDealt(s)).length;

            let cardsPlayed = p.plays[p.plays.length - 1];
            let partialSeen = this.core.getCardsPlayedCollection(p.index);

            let partialTeamWantsByTeam = new Array(this.T).fill(0);
            for (let i = this.core.players.nextUnkicked(this.core.getDealer()); i != p.index; i = this.core.players.nextUnkicked(i)) {
                let p2 = this.core.players.players[i];
                let teamIndex = this.realIndex[p2.team];
                partialTeamWantsByTeam[teamIndex] = Math.min(this.core.getHandSize(), partialTeamWantsByTeam[teamIndex] + p2.bid);
            }
            let partialTeamWants = new Array(this.N);
            for (const p2 of this.core.players.players) {
                partialTeamWants[p2.index] = partialTeamWantsByTeam[this.realIndex[p2.team]];
            }

            let j = 0;
            for (const card of cardsPlayed) {
                let vec = this.getOvlForTtl(card, voidApprox, partialSeen, p.index, partialTeamWants);
                this.teamOvls[p.index][j] = this.ovl.evaluate(vec).get(0);
                j++;
            }
        }

        if (!biddingOnly) {
            this.canPlay = this.core.whatCanIPlay(this.player.index);

            this.trickAdjustedNumbers = new Array(this.N).fill(0);
            this.trickMatchesUnseen = new Array(this.N).fill(0);
            for (const p of this.core.players.players) {
                let card = p.trick;

                if (!card.isEmpty()) {
                    this.trickAdjustedNumbers[p.index] = this.seen.cardValue(card);
                    this.trickMatchesUnseen[p.index] = this.seen.matchesLeft(card);
                }
            }
        }
    }

    clearQsMemo() {
        this.teamQsMemo = new Array(this.N).fill(undefined);
    }

    getUnseen(suit) {
        return this.seen.cardsLeftOfSuit(suit);
    }

    getQs(max, card, index) {
        let ps = this.getPs(card, index);
        if (debug) {
            log('ovl {', this.logDepth);
            this.logDepth++;
            let i = 0;
            for (const c of this.player.hand) {
                if (c === card) {
                    continue;
                }
                log(`${c.toString()}, ${ps[i]}`, this.logDepth);
                i++;
            }
            this.logDepth--;
            log('}', this.logDepth);
        }

        return this.subsetProb(ps, max);
    }

    getPs(card, index) {
        let h = this.player.hand.length;
        if (card !== undefined) {
            h--;
        }
        let ps = new Array(h);
        let i = 0;
        for (const c of this.player.hand) {
            if (c === card) {
                continue;
            }
            ps[i] = this.getP(c, card, index);
            i++;
        }

        return ps;
    }

    getP(card, myCard, index) {
        let voidInc = (myCard !== undefined && this.suitCounts[myCard.suit] == 1) ? 1 : 0;
        let code = encodeCP(card, voidInc);
        if (this.ovlMemo[index][code] === undefined) {
            this.ovlMemo[index][code] = this.ovl.evaluate(this.getOvl(card, myCard, index)).get(0);
        }
        return this.ovlMemo[index][code];
    }

    subsetProb(ps, l) {
        let qs = new Array(l + 1).fill(0);
        qs[0] = 1;
        for (let i = 0; i < ps.length; i++) {
            let prev = 0;
            for (let j = 0; j <= i + 1 && j <= l; j++) {
                let next = qs[j];
                qs[j] = prev * ps[i] + next * (1 - ps[i]);
                prev = next;
            }
        }
        return qs;
    }

    chooseBid(qs) {
        // Comments copied from Java
        let bids = this.orderDesiredBids(qs);

        // Find the top choice bid that will not make the team overbid or force the dealer to
        // overbid if the dealer is on the team (note to self (TODO) -- this dealer thing may not
        // be necessary in all cases. Maybe we could want to bid to the max even if the dealer is
        // on our team because we think the other team will bid in between?).
        let maxBid = this.core.highestMakeableBid(this.player.index, true);

        let choice = 0;
        while (bids[choice] - this.teamWantsBeforePlay > maxBid || bids[choice] < this.teamWantsBeforePlay) {
            choice++;
        }

        // If we can't bid that, then move one further
        if (bids[choice] - this.teamWantsBeforePlay == this.core.whatCanINotBid(this.player.index)) {
            do {
                choice++;
            } while (bids[choice] < this.teamWantsBeforePlay);
        }

        if (choice < bids.length) {
            return bids[choice];
        } else {
            // I think this can happen only when (1) bidding 0 was our last choice, (2) we
            // couldn't bid it because we're the dealer, and (3) all other teams bid 0, and (4)
            // someone on our team fucked us. Extremely unlikely scenario. Bid 1.
            return 1;
        }
    }

    orderDesiredBids(qs) {
        let n = qs.length - 1;

        let bidEPairs = new Array(n + 1);

        // my magical linear time algorithm
        for (let k = 0; k <= 1; k++) {
            bidEPairs[k] = [k, 0]
            for (let l = 0; l <= n; l++) {
                bidEPairs[k][1] += qs[l] * this.core.scoreFunc(k, l);
            }
        }

        for (let k = 2; k <= n; k++) {
            bidEPairs[k] = [
                k,
                bidEPairs[k - 1][1] * 2
                    - bidEPairs[k - 2][1]
                    - 5
                    + qs[k - 2] * (14 - 4 * k + k * k)
                    + qs[k - 1] * (-27 + 4 * k - 2 * k * k)
                    + qs[k] * (10 + k * k)
            ];
        }

        bidEPairs.sort((pair1, pair2) => Math.sign(pair2[1] - pair1[1]));
        return bidEPairs.map(pair => pair[0]);
    }

    choosePlay(probs) {
        let bestProb = -1;
        let bestPlays = [];

        for (const pair of probs) {
            if (pair[1] > bestProb) {
                bestProb = pair[1];
                bestPlays = [];
            }
            if (pair[1] == bestProb) {
                bestPlays.push(pair[0]);
            }
        }

        return bestPlays[Math.floor(Math.random() * bestPlays.length)];
    }

    getIvl(myCard, requiredCancels) {
        let vec = new ml.SparseVector();

        // some basic data
        let iAmLeading = this.player.index == this.core.leader;
        let trumpSuit = this.core.getTrump().suit;
        let lead = iAmLeading ? myCard : this.core.getLead();

        // features
        vec.addOneHot('Initial hand size', this.core.getHandSize(), 1, this.maxH);
        vec.addOneHot('Current hand size', this.player.hand.length - (myCard === undefined ? 0 : 1), 0, this.maxH - 1);
        vec.addOneHot('Trump unseen', this.seen.cardsLeftOfSuit(trumpSuit), 0, 13 * this.D - 1);
        vec.addOneHot('Led suit unseen', this.seen.cardsLeftOfSuit(lead.suit), 0, 13 * this.D - 1);
        vec.addOneHot('Lead is trump', lead.suit == trumpSuit ? 1 : 0, 0, 1);
        for (let j = 0; j < this.N; j++) {
            let i = j;
            let player = this.core.players.players[i];

            let isTrumpFeat = 0;
            let adjustedNumberFeat = 0;
            let matchingCardsLeftFeat = 0;
            let requiredCancelsFeat = requiredCancels[i];
            let ledFeat = 0;

            if (player.played) {
                isTrumpFeat = player.trick.suit == trumpSuit ? 1 : 0;
                adjustedNumberFeat = this.trickAdjustedNumbers[i];
                matchingCardsLeftFeat = this.trickMatchesUnseen[i];
                ledFeat = player.trick === lead ? 1 : 0;
            } else if (i == this.player.index) {
                isTrumpFeat = myCard.suit == trumpSuit ? 1 : 0;
                adjustedNumberFeat = this.handAdjustedNumbers[myCard.toNumber()];
                matchingCardsLeftFeat = this.handMatchesUnseen[myCard.toNumber()];
                ledFeat = myCard === lead ? 1 : 0;
            }

            vec.addOneHot(j + ' Team number', this.realIndex[player.team], 0, this.T - 1);
            vec.addOneHot(j + ' Bid', player.bid, 0, this.maxH);
            vec.addOneHot(j + ' Taken', player.taken, 0, this.maxH - 1);
            vec.addOneHot(j + ' Team wants', this.teamWant[i], 0, this.maxH);
            vec.addOneHot(j + ' Trump void', player.shownOut[trumpSuit] ? 1 : 0, 0, 1);
            vec.addOneHot(j + ' Lead void', player.shownOut[lead.suit] ? 1 : 0, 0, 1);
            vec.addOneHot(j + ' Is trump', isTrumpFeat, 0, 1);
            vec.addOneHot(j + ' Adjusted number', adjustedNumberFeat, 0, 13 * this.D);
            vec.addOneHot(j + ' Matches unseen', matchingCardsLeftFeat, 0, this.D - 1);
            vec.addOneHot(j + ' Required cancels', requiredCancelsFeat, -2, this.maxCancels);
            vec.addOneHot(j + ' Led', ledFeat, 0, 1);
        }

        if (debug) {
            log(`in - ivl ${myCard.toString()} {`, this.logDepth);
            this.logDepth++;

            for (const line of vec.printL()) {
                log(line, this.logDepth);
            }

            this.logDepth--;
            log('}', this.logDepth);
        }

        return vec;
    }

    getOvl(card, myCard, leaderIndex) {
        let vec = new ml.SparseVector();

        // some basic data
        let trumpSuit = this.core.getTrump().suit;
        let winnerTeam = this.core.players.players[leaderIndex].team;
        let voidCount = Math.min(this.voidCount + (myCard !== undefined && this.suitCounts[myCard.suit] == 1 ? 1 : 0), 3);

        // features
        vec.addOneHot('Initial hand size', this.core.getHandSize(), 1, this.maxH);
        vec.addOneHot('Current hand size', this.player.hand.length - (myCard === undefined ? 0 : 1), 0, this.maxH);
        vec.addOneHot('Void count', voidCount, 0, 3);
        vec.addOneHot('Trump unseen', this.seen.cardsLeftOfSuit(trumpSuit), 0, 13 * this.D - 1);
        vec.addOneHot('Card\'s suit unseen', this.seen.cardsLeftOfSuit(card.suit), 0, 13 * this.D - 1);
        vec.addOneHot('Card is trump', card.suit == trumpSuit ? 1 : 0, 0, 1);
        vec.addOneHot('Card\'s adjusted number', this.handAdjustedNumbers[card.toNumber()], 0, 13 * this.D);
        vec.addOneHot('Card\'s matches unseen', this.handMatchesUnseen[card.toNumber()], 0, this.D - 1);
        for (let j = 0; j < this.N; j++) {
            let i = (this.player.index + j) % this.N;
            let player = this.core.players.players[i];

            let taken = player.taken;
            let teamWants = this.teamWant[i];

            if (myCard !== undefined) {
                if (i == leaderIndex) {
                    taken++;
                }
                if (player.team == winnerTeam) {
                    teamWants = Math.max(teamWants - 1, 0);
                }
            }

            vec.addOneHot(j + ' Team number', this.realIndex[player.team], 0, this.T - 1);
            vec.addOneHot(j + ' Bid', player.bidded ? player.bid : -1, -1, this.maxH);
            vec.addOneHot(j + ' Taken', taken, 0, this.maxH - 1);
            vec.addOneHot(j + ' Team wants', teamWants, 0, this.maxH);
            vec.addOneHot(j + ' Trump void', player.shownOut[trumpSuit] ? 1 : 0, 0, 1);
            vec.addOneHot(j + ' Card\'s suit void', player.shownOut[card.suit] ? 1 : 0, 0, 1);
            vec.addOneHot(j + ' Will be on lead', player.index == leaderIndex ? 1 : 0, 0, 1);
        }

        if (debug) {
            log(`in - ovl ${myCard === undefined ? "null" : myCard.toString()} ${leaderIndex} ${card.toString()} {`, this.logDepth);
            this.logDepth++;

            for (const line of vec.printL()) {
                log(line, this.logDepth);
            }

            this.logDepth--;
            log('}', this.logDepth);
        }

        return vec;
    }

    getOvlForTtl(card, voidApprox, partialSeen, index, partialTeamWants) {
        let vec = new ml.SparseVector();

        // some basic data
        let trumpSuit = this.core.getTrump().suit;
        let leaderIndex = this.core.players.nextUnkicked(this.core.getDealer());

        // features
        vec.addOneHot('Initial hand size', this.core.getHandSize(), 1, this.maxH);
        vec.addOneHot('Current hand size', this.core.getHandSize(), 0, this.maxH);
        vec.addOneHot('Void count', voidApprox, 0, 3);
        vec.addOneHot('Trump unseen', partialSeen.cardsLeftOfSuit(trumpSuit), 0, 13 * this.D - 1);
        vec.addOneHot('Card\'s suit unseen', partialSeen.cardsLeftOfSuit(card.suit), 0, 13 * this.D - 1);
        vec.addOneHot('Card is trump', card.suit == trumpSuit ? 1 : 0, 0, 1);
        vec.addOneHot('Card\'s adjusted number', partialSeen.cardValue(card), 0, 13 * this.D);
        vec.addOneHot('Card\'s matches unseen', partialSeen.matchesLeft(card), 0, this.D - 1);
        let hasBid = false;
        for (let j = 0; j < this.N; j++) {
            let i = (index + j) % this.N;
            let player = this.core.players.players[i];

            if (i == leaderIndex && i != index) {
                hasBid = true;
            }

            vec.addOneHot(j + ' Team number', this.realIndex[player.team], 0, this.T - 1);
            vec.addOneHot(j + ' Bid', hasBid ? player.bid : -1, -1, this.maxH);
            vec.addOneHot(j + ' Taken', 0, 0, this.maxH - 1);
            vec.addOneHot(j + ' Team wants', partialTeamWants[i], 0, this.maxH);
            vec.addOneHot(j + ' Trump void', 0, 0, 1);
            vec.addOneHot(j + ' Card\'s suit void', 0, 0, 1);
            vec.addOneHot(j + ' Will be on lead', player.index == leaderIndex ? 1 : 0, 0, 1);
        }

        if (debug) {
            log(`in {`, this.logDepth);
            this.logDepth++;

            for (const line of vec.printL()) {
                log(line, this.logDepth);
            }

            this.logDepth--;
            log('}', this.logDepth);
        }

        return vec;
    }

    getTtl(index, myCard, leaderIndex) {
        let vec = new ml.SparseVector();

        // some basic data
        let trumpSuit = this.core.getTrump().suit;
        let teammate = this.core.players.players[index];
        let teammateVoidCount = [0, 1, 2, 3].filter(s => teammate.shownOut[s]).length;
        let winnerTeam = this.core.players.players[leaderIndex].team;

        // features
        vec.addOneHot('Initial hand size', this.core.getHandSize(), 1, this.maxH);
        vec.addOneHot('Current hand size', this.player.hand.length - (myCard === undefined ? 0 : 1), 0, this.maxH);
        vec.addOneHot('Void count', teammateVoidCount, 0, 3);
        vec.addOneHot('Trump unseen', this.seen.cardsLeftOfSuit(this.core.getTrump().suit), 0, 13 * this.D - 1);

        let ovls = this.teamOvls[index];
        for (let j = 0; j < this.maxH; j++) {
            vec.addOneHot(j + ' Card played', ovls[j] === undefined ? 0 : 1, 0, 1);
            vec.addValue(j + ' Card strength', ovls[j] === undefined ? 0 : ovls[j]);
        }

        for (let j = 0; j < this.N; j++) {
            let i = (index + j) % this.N;
            let player = this.core.players.players[i];

            let taken = player.taken;
            let teamWants = this.teamWant[i];

            if (myCard !== undefined) {
                if (i == leaderIndex) {
                    taken++;
                }
                if (player.team == winnerTeam) {
                    teamWants = Math.max(teamWants - 1, 0);
                }
            }

            vec.addOneHot(j + ' Team number', this.realIndex[player.team], 0, this.T - 1);
            vec.addOneHot(j + ' Bid', player.bid, 0, this.maxH);
            vec.addOneHot(j + ' Taken', taken, 0, this.maxH - 1);
            vec.addOneHot(j + ' Team wants', teamWants, 0, this.maxH);
            vec.addOneHot(j + ' Trump void', player.shownOut[trumpSuit] ? 1 : 0, 0, 1);
            vec.addOneHot(j + ' Will be on lead', player.index == leaderIndex ? 1 : 0, 0, 1);
        }

        if (debug) {
            log(`in - ttl ${myCard === undefined ? "null" : myCard.toString()} ${leaderIndex} ${index} {`, this.logDepth);
            this.logDepth++;

            for (const line of vec.printL()) {
                log(line, this.logDepth);
            }

            this.logDepth--;
            log('}', this.logDepth);
        }

        return vec;
    }
}

// cpp wrapper -----------------------------------------------------------------
class StrategyModuleEuchreCore {
    constructor() { }

    setCoreAndPlayer(core, player) {
        this.core = core
        this.player = player

        if (this.core.coreCpp === undefined) {
            this.setCoreCpp()
        }
    }

    setCoreCpp() {
        let seed = Math.floor(Math.random() * 2147483648)
        this.core.coreCpp = new _euchre.EuchreCoreRandom(seed)
    }

    chooseTrump() {
        return this.core.coreCpp.chooseTrump()
    }

    orderUp() {
        return this.core.coreCpp.orderUp()
    }

    makePlay() {
        return this.core.coreCpp.getCardPlay()
    }
}

class StrategyModuleEuchreCoreMarkov extends StrategyModuleEuchreCore {
    constructor() { super() }

    setCoreCpp() {
        let maxRounds = 0
        let seed = Math.floor(Math.random() * 2147483648)
        let log = false
        let logRule = [false, false, false, false]
        let coreCpp = new _euchre.EuchreCoreMarkov(maxRounds, seed, log, logRule)

        let weights = {}
        let mtime
        for (let name of ['tnn', 'pnn', 'rnn', 'wnn']) {
            weights[name] = []
            let nn = new ml.NNModel(`./models/euchre/${name}.txt`, [])
            for (let layer of nn.layers) {
                if (!layer.input) {
                    weights[name].push([layer.w.matrix, layer.b.vec])
                }
            }
            mtime = nn.mtime
        }
        coreCpp.setWeights(weights)

        this.core.incomingChat(undefined, `StrategyModuleEuchreCoreMarkov weights last modified ${mtime}`)

        this.core.coreCpp = coreCpp
    }
}

class StrategyModuleEuchreCoreOIT extends StrategyModuleEuchreCore {
    constructor() { super() }

    setCoreCpp() {
        let maxRounds = 0
        let seed = Math.floor(Math.random() * 2147483648)
        let log = false
        let logRule = [false, false, false, false]
        let coreCpp = new _euchre.EuchreCoreOIT(maxRounds, seed, log, logRule)

        let weights = {}
        let mtime
        for (let name of ['onn', 'inn', 'tnn', 'wnn']) {
            weights[name] = []
            let nn = new ml.NNModel(`./models/euchre/${name}.txt`, [])
            for (let layer of nn.layers) {
                if (!layer.input) {
                    weights[name].push([layer.w.matrix, layer.b.vec])
                }
            }
            if (name != 'wnn') {
                mtime = nn.mtime
            }
        }
        coreCpp.setWeights(weights)

        this.core.incomingChat(undefined, `StrategyModuleEuchreCoreOIT weights last modified ${mtime}`)

        this.core.coreCpp = coreCpp
    }
}

// entry point -----------------------------------------------------------------
function buildModules(mode, params) {
    switch (mode) {
        case 'Oh Hell':
            return withTrained(buildModulesOhHell(params), params);

        case 'Hearts':
            return new Array(params.N).fill(0).map(x => new StrategyModuleDumb());

        case 'Euchre':
            return new Array(params.N).fill(0).map(x => new StrategyModuleEuchreCoreOIT());
    }
}

// Seats with params.trained[i] = a model id play with that trained model
// (trained_ai/), keeping the built-in module underneath for analysis. A seat
// whose model has no version for this table (teams, player or deck count)
// keeps the built-in AI.
function withTrained(modules, params) {
    if (!params.trained || !params.trained.some(x => x)) {
        return modules;
    }
    return modules.map((m, i) => {
        const id = params.trained[i];
        if (!id) {
            return m;
        }
        if (!trainedAi.supported(id, params.N, params.D, params.T)) {
            console.log(`AI Trained model ${id} has no model for N=${params.N} D=${params.D} T=${params.T}; seat ${i} uses the built-in AI.`);
            return m;
        }
        return new trainedAi.StrategyModuleTrained(params.N, params.D, m, id);
    });
}

function buildModulesOhHell(params) {
    if (params.T != 0) {
        return buildModulesOITeam(params.N, params.D, params.T);
        // try {
        //     return buildModulesOITeam(params.N, params.D, params.T);
        // } catch (e) {
        //     console.log(`Failed to load OIT for params={N: ${params.N}, D: ${params.D}, T: ${params.T}}. Falling back to OI.`);
        // }
    }

    return buildModulesOI(params.N, params.D);
}

function buildModulesOI(N, D) {
    let ovl = new ml.NNModel(`./models/N${N}/D${D}/T0/ovl.txt`, ['ReLu', 'Sigmoid']);
    let ivl = new ml.NNModel(`./models/N${N}/D${D}/T0/ivl.txt`, ['ReLu', 'Sigmoid']);
    let modules = new Array(N);
    for (let i = 0; i < N; i++) {
        modules[i] = new StrategyModuleOI(N, D, ovl, ivl);
    }
    return modules;
}

function buildModulesOITeam(N, D, T) {
    let ovl = new ml.NNModel(`./models/N${N}/D${D}/T${T}/ovl.txt`, ['ReLu', 'Sigmoid']);
    let ivl = new ml.NNModel(`./models/N${N}/D${D}/T${T}/ivl.txt`, ['ReLu', 'Softmax']);
    let ttl = new ml.NNModel(`./models/N${N}/D${D}/T${T}/ttl.txt`, ['ReLu', 'Softmax']);
    let modules = new Array(N);
    for (let i = 0; i < N; i++) {
        modules[i] = new StrategyModuleOITeam(N, D, T, ovl, ivl, ttl);
    }
    return modules;
}

module.exports = {
    buildStrategyModules: buildModules,
    pointsMean: pointsMean,
    pointsVariance: pointsVariance,
    robotNames: robotNames
}
