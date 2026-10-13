const log = require('./logging').log
const trainedAi = require('./trained_ai/strategy')
var ai = require('./ai');
var card = require('./card');

class Player {
    constructor() {
        this.kibitzer = false;
        this.replacedByRobot = false;
        this.team = 0;
    }

    toDict(visible) {
        return {
            name: this.name,
            id: this.id,
            human: this.human,
            host: this.host,
            disconnected: this.disconnected,
            replacedByRobot: this.replacedByRobot,
            kibitzer: this.kibitzer,
            index: this.index,
            team: this.team,
            bid: this.bid,
            bidded: this.bidded,
            taken: this.taken,
            score: this.score,
            hand: this.hand ? this.hand.map(c => visible ? c : new card.Card()) : [],
            trick: this.trick,
            played: this.played,
            lastTrick: this.lastTrick,
            decision: visible ? this.decision : undefined,
            bids: this.bids,
            takens: this.takens,
            scores: this.scores,
            pass: this.pass ? this.pass.map(c => visible ? c : new card.Card()) : [],
            passed: this.passed
        };
    }

    toPostGameDict() {
        return {
            id: this.id,
            name: this.name,
            index: this.index,
            team: this.team,
            human: this.human,
            hands: this.hands.map(h => h.map(c => c.toDict())),
            bids: this.bids,
            takens: this.takens,
            scores: this.scores,
            score: this.score,
            plays: this.plays.map(r => r.map(c => c.toDict())),
            wbProbs: this.wbProbs,
            bidQs: this.bidQs,
            makingProbs: this.makingProbs.map(r => r.map(t => t.map(pair => [pair[0].toDict(), pair[1]]))),
            aiBids: this.aiBids,
            diffs: this.diffs,
            lucks: this.lucks,
            hypoPointsLost: this.hypoPointsLost,
            mistakes: this.mistakes
        };
    }

    newGameReset() {
        this.score = 0;
        this.trick = new card.Card();
        this.lastTrick = new card.Card();
        this.bids = [];
        this.takens = [];
        this.scores = [];
        this.hands = [];
        this.plays = [];
        this.passes = [];

        this.wbProbs = [];
        this.bidQs = [];
        this.makingProbs = [];
        this.aiBids = [];
        this.diffs = [];
        this.lucks = [];
        this.hypoPointsLost = [];
        this.mistakes = [];
    }

    newRoundReset() {
        this.bid = 0;
        this.taken = 0;
        this.bidded = false;
        this.trick = new card.Card();
        this.played = false;
        this.lastTrick = new card.Card();
        this.acceptedClaim = false;
        this.plays.push([]);
        this.pass = [];
        this.passed = false;
        this.cardsTaken = [];
        this.shownOut = [false, false, false, false];
        this.hadSuit = [false, false, false, false];

        this.makingProbs.push([]);
        this.roundMistakes = 0;
    }

    newTrickReset() {
        this.lastTrick = this.trick;
        this.trick = new card.Card();
        this.played = false;
    }

    addHand(hand) {
        this.hand = hand;
        this.hands.push(hand.map(c => c));
    }

    addPlay(card) {
        this.trick = card;
        this.played = true;
        for (let i = 0; i < this.hand.length; i++) {
            if (this.hand[i].matches(card)) {
                this.hand.splice(i, 1);
            }
        }

        this.plays[this.plays.length - 1].push(card);
    }

    addPass(cards) {
        this.pass = cards;
        this.passed = true;
        this.passes.push(cards);
    }

    incTaken(cards) {
        this.taken++;
    }

    addTaken() {
        this.takens.push(this.taken);
    }

    addScore(score) {
        this.score += score;
        this.scores.push(this.score);
    }

    voidDealt(suit) {
        return this.shownOut[suit] && !this.hadSuit[suit];
    }

    addWbProb(p) {
        this.wbProbs.push(p);
    }

    startBid(data) {
        if (data.turn == this.index && !this.kibitzer) {
            this.bidAsync();
        }
        //this.commandBid(data);
    }

    async bidAsync(delay) {
        let bid = await this.strategyModule.makeBid();
        this.bidReady(bid, delay);
    }

    async playAsync(delay) {
        let card = await this.strategyModule.makePlay();
        this.playReady(card, delay);
    }

    async passAsync(delay) {
        let cards = await this.strategyModule.makePass();
        this.passReady(cards, delay);
    }

    startDecision(data) {
        if (!this.kibitzer) {
            this.decision = data;
            this.decisionAsync(data);
            this.commandDecision(data);
        }
    }

    async decisionAsync(data, delay) {
        let choice = await this.strategyModule.makeDecision(data);
        this.decisionReady(choice, delay);
    }

    reconnect(player) { }

    poke() { }

    commandGameState(data) { }
    flushDiffs(data) { }
    commandAddPlayers(data) { }
    commandRemovePlayers(data) { }
    commandUpdatePlayers(data) { }
    commandUpdateTeams(data) { }
    commandStart() { }
    commandBid(data) { }
    bidReady(bid) { }
    commandPlay(data) { }
    playReady(card) { }
    commandPass(data) { }
    passReady(cards) { }
    commandDecision(data) { }
    decisionReady(card) { }
    removeDecision() { }
    commandDeal(data) { }
    updateHands(data) { }
    commandPassReport(data) { }
    commandTrickWinner(data) { }
}

function createHumanPlayer(base) {
    class HumanPlayer extends base {
        constructor(user, core, ...args) {
            super(...args)
            this.user = user;
            this.core = core;
            this.id = user.id;
            this.disconnected = false;
            this.human = true;
        }

        reconnect(user) { // TODO fix this
            if (this.user.socket.connected && this.user.socket !== user.socket) {
                this.user.send('kick');
            }

            this.user = user;
            user.player = this;
        }

        commandJoin(data) {
            this.user.send('join', data);
        }

        commandGameState(data) {
            this.user.send('gamestate', data);
        }

        flushDiffs(data, immediate) {
            let name = immediate ? 'gamestate_immediate' : 'gamestate'
            this.user.send(name, data)
        }

        commandAddPlayers(data) {
            this.user.send('addplayers', data);
        }

        commandRemovePlayers(data) {
            this.user.send('removeplayers', data);
        }

        commandUpdatePlayers(data) {
            this.user.send('updateplayers', data);
        }

        commandUpdateTeams(data) {
            this.user.send('updateteams', data);
        }

        commandStart() {
            this.user.send('start');
        }

        commandDeal(data) {
            if (this.kibitzer) {
                this.user.send('deal', data);
            } else {
                this.user.send('deal', {
                    hands: data.hands.map((h, i) => h.map(c => i == this.index ? c : { num: 0, suit: 0 })),
                    trump: data.trump
                });
            }
        }

        updateHands(data) {
            if (this.kibitzer) {
                this.user.send('performpass', data);
            } else {
                this.user.send('performpass', {
                    hands: data.hands.map((h, i) => h.map(c => i == this.index ? c : { num: 0, suit: 0 })),
                    pass: data.pass.map((h, i) => h.map(c => i == this.index || data.passedTo[i] == this.index ? c : { num: 0, suit: 0 })),
                    passedTo: data.passedTo
                });
            }
        }

        commandBid(data) {
            this.user.send('bid', data);
        }

        commandPlay(data) {
            this.user.send('play', data);
        }

        commandPass(data) {
            this.user.send('pass', data);
        }

        commandDecision(data) {
            //this.user.send('decision', data);
        }

        commandPassReport(data) {
            let copy = data.cards.map(c => data.index == this.index || this.kibitzer ? c : new card.Card());
            this.user.send('passreport', { index: data.index, cards: copy });
        }

        commandTrickWinner(data) {
            this.user.send('trickwinner', data);
        }

        setDisconnected(disc) {
            this.disconnected = disc;
            if (!disc) {
                this.replacedByRobot = false;
            }
        }

        replaceWithRobot() {
            this.replacedByRobot = true;
            if (this.readiedBid !== undefined) {
                this.core.incomingBid(this.index, this.readiedBid);
                this.readiedBid = undefined;
            } else if (this.readiedPlay !== undefined) {
                this.core.incomingPlay(this.index, this.readiedPlay);
                this.readiedPlay = undefined;
            } else if (this.readiedPass !== undefined) {
                this.core.incomingPass(this.index, this.readiedPass);
                this.readiedPass = undefined;
            } else if (this.readiedDecision !== undefined) {
                this.core.makeDecision(this.index, this.readiedDecision);
                this.readiedDecision = undefined;
            }
        }

        async bidReady(bid, delay) {
            if (this.replacedByRobot) {
                await new Promise(r => setTimeout(r, delay))
                this.core.incomingBid(this.index, bid);
                this.readiedBid = undefined;
            } else {
                this.readiedBid = bid;
            }
        }

        async playReady(card, delay) {
            if (this.replacedByRobot) {
                await new Promise(r => setTimeout(r, delay))
                this.core.incomingPlay(this.index, card);
                this.readiedPlay = undefined;
            } else {
                this.readiedPlay = card;
            }
        }

        async passReady(cards, delay) {
            if (this.replacedByRobot) {
                await new Promise(r => setTimeout(r, delay))
                this.core.incomingPass(this.index, cards);
                this.readiedPass = undefined;
            } else {
                this.readiedPass = cards;
            }
        }

        async decisionReady(choice, delay) {
            if (this.replacedByRobot) {
                await new Promise(r => setTimeout(r, delay))
                this.core.makeDecision(this.index, choice);
                this.readiedDecision = undefined;
            } else {
                this.readiedDecision = choice;
            }
        }

        poke() {
            this.user.send('poke');
        }

        removeDecision() {
            this.decision = undefined;
        }
    }
    return HumanPlayer
}

function createAiPlayer(base) {
    class AiPlayer extends base {
        constructor(i, core, ...args) {
            super(...args)
            this.disconnected = false;
            this.human = false;
            this.id = '@robot' + i;
            this.name = ai.robotNames[Math.floor(ai.robotNames.length * Math.random())] + ' bot'
            this.core = core;
        }

        async bidReady(bid, delay) {
            await new Promise(r => setTimeout(r, delay))
            this.core.incomingBid(this.index, bid);
        }

        async playReady(card, delay) {
            await new Promise(r => setTimeout(r, delay))
            this.core.incomingPlay(this.index, card);
        }

        async passReady(cards, delay) {
            await new Promise(r => setTimeout(r, delay))
            this.core.incomingPass(this.index, cards);
        }

        async decisionReady(choice, delay) {
            await new Promise(r => setTimeout(r, delay))
            this.core.makeDecision(this.index, choice);
        }

        removeDecision() {
            this.decision = undefined;
        }
    }
    return AiPlayer
}

class PlayersList {
    constructor(game) {
        this.game = game;
        this.players = [];
        this.kibitzers = [];
        this.teams = [];
        for (let i = 0; i < 10; i++) {
            this.teams.push(new Team(i, this));
        }
    }

    playersDict(index) {
        if (arguments.length == 0) {
            index = -1;
        }
        return this.players.map(p => p.toDict(index == -1 || p.index == index))
    }

    kibitzersDict() {
        return this.kibitzers.map(p => p.toDict(true))
    }

    setCore(core) {
        this.core = core;
    }

    size() {
        return this.players.length;
    }

    get(i) {
        return this.players[i];
    }

    emitAll(type, data) {
        for (const list of [this.players, this.kibitzers]) {
            for (const player of list) {
                if (player.human && player.user.socket.connected) {
                    player.user.send(type, data);
                }
            }
        }
    }

    addPlayer(player) {
        // check if it's a reconnect
        let reconnect = false
        for (const p of this.players) {
            if (p.id == player.id) {
                p.reconnect(player.user)
                p.setDisconnected(false)
                if (player.host) {
                    // Feels like this could be better
                    p.host = true
                    this.game.host = p
                }
                player = p
                reconnect = true
                this.core.addUpdateDiff({ 'players': { [player.index]: { disconnected: false, host: player.host } } })
                break
            }
        }

        let existingPlayers = this.players.filter(p => p.id != player.id).concat(this.kibitzers.filter(p => p.id != player.id))

        if (!reconnect) {
            if (this.core.isInGame()) {
                this.addPlayers([], [player])
            } else {
                this.addPlayers([player], [])
            }
        }

        // First let existing players know of the new player
        this.core.flushDiffs(existingPlayers)

        // Then give the new player the game state
        this.core.sendGameState(player)

        this.game.stopExpirationTimer()
    }

    adjustRobotCount(count) {
        let robots = this.getRobots();
        if (robots.length == count) {
            return
        }

        if (robots.length < count) {
            let newRobots = []
            for (let i = robots.length; i < count; i++) {
                newRobots.push(this.core.createAiPlayer(i + 1))
            }
            this.addPlayers(newRobots, [])
        } else if (robots.length > count) {
            this.removePlayers(robots.slice(count), []);
        }
    }

    attachStrategyModules(modules) {
        for (let i = 0; i < modules.length; i++) {
            this.players[i].strategyModule = modules[i];
            modules[i].setCoreAndPlayer(this.core, this.players[i]);
        }
    }

    getRobots() {
        return this.players.filter(p => !p.human);
    }

    disconnectPlayer(player, kick) {
        let inGame = this.core.isInGame()

        if (player.kibitzer) {
            this.removePlayers([], [player])
        } else if (!inGame) {
            this.removePlayers([player], [])
        } else {
            player.setDisconnected(true)
            this.core.addUpdateDiff({ players: { [player.index]: { disconnected: true } } })
        }

        if (this.players.filter(p => p.human && !p.disconnected).length == 0 && this.kibitzers.length == 0) {
            this.game.startExpirationTimer();

            // we don't want to dispose of the game right away
            if (!inGame) {
                this.game.listed = false;
            }
        }

        if (this.game.host === player) {
            this.game.host.host = false;
            this.game.host = undefined;
            for (const p of this.players) {
                if (!p.disconnected && p.human) {
                    this.game.host = p;
                    p.host = true;
                    this.core.addUpdateDiff({ players: { [p.index]: { host: true } } })
                    break
                }
            }
        }

        this.core.flushDiffs()
    }

    addPlayers(players, kibitzers) {
        let diff = { players: {}, kibitzers: {} }
        for (let player of players) {
            player.index = this.players.length
            player.kibitzer = false
            this.players.push(player)
            diff.players[player.index] = player.toDict()
        }
        if (kibitzers) {
            for (let player of kibitzers) {
                player.index = Math.floor(Math.random() * this.players.length)
                player.kibitzer = true
                this.kibitzers.push(player)
                diff.kibitzers[this.kibitzers.length - 1] = player.toDict()
            }
        }
        this.core.addUpdateDiff(diff)
        this.updateTeams()
    }

    removePlayers(players, kibitzers) {
        // Remove
        let removeDiff = {}
        this.players = this.players.filter(p => !players.includes(p));
        removeDiff.players = players.map(p => p.index)
        if (kibitzers) {
            removeDiff.kibitzers = kibitzers.map(p => this.kibitzers.map(q => q.id).indexOf(p.id))
            this.kibitzers = this.kibitzers.filter(p => !kibitzers.includes(p))
        }
        this.core.addRemoveDiff(removeDiff)

        // Shift indices
        let updateDiff = { players: [] }
        for (let i = 0; i < this.players.length; i++) {
            this.players[i].index = i;
            updateDiff.players[i] = { index: i }
        }
        this.core.addUpdateDiff(updateDiff)
        this.updateTeams()
    }

    updatePlayers(players) {
        let data = { players: players.map(p => p.toDict()) };
        for (const list of [this.players, this.kibitzers]) {
            for (const p of list) {
                p.commandUpdatePlayers(data);
            }
        }
    }

    updatePlayer(data) {
        let player = undefined;
        for (const p of this.players) {
            if (p.id == data.id) {
                player = p;
                break;
            }
        }
        if (!player) {
            for (const p of this.kibitzers) {
                if (p.id == data.id) {
                    player = p;
                    break;
                }
            }
        }

        player.name = data.name;

        if (!player.kibitzer && data.kibitzer) {
            this.removePlayers([player], [])
            this.addPlayers([], [player])
        } else if (player.kibitzer && !data.kibitzer) {
            this.removePlayers([], [player])
            this.addPlayers([player], [])
        } else {
            this.core.addUpdateDiff({
                players: {
                    [player.index]: {
                        name: data.name,
                        kibitzer: data.kibitzer
                    }
                }
            })
        }

        this.core.flushDiffs()
    }

    randomizePlayerOrder() {
        let newPlayers = []
        let playersToChoose = this.players.map(p => p)
        for (let j = 0; j < this.players.length; j++) {
            newPlayers.push(playersToChoose.splice(Math.floor(Math.random() * playersToChoose.length), 1)[0])
        }

        this.removePlayers(this.players)
        this.addPlayers(newPlayers)

        this.core.addUpdateDiff({ kibitzers: this.kibitzers.map(p => ({ index: Math.floor(Math.random() * this.players.length) })) })

        this.core.addUpdateDiff({}, { playersRandomized: true })
        this.core.flushDiffs()
    }

    updateOptions(options) {
        this.adjustRobotCount(options.robots);
        this.assignTrainedRobots(options.trainedRobots, options.trainedModels);
        //this.emitAll('options', options);
    }

    // The first `count` robots play with the trained models (trained_ai/), robot k
    // with models[k] (a catalog id, default Champion); their names say which.
    assignTrainedRobots(count, models) {
        this.getRobots().forEach((robot, k) => {
            if (robot.baseName === undefined) {
                robot.baseName = robot.name.replace(/ bot$/, '')
            }
            robot.trained = k < (parseInt(count) || 0)
            robot.trainedModel = robot.trained ? ((models || [])[k] || trainedAi.DEFAULT_MODEL) : undefined
            let name = robot.baseName + (robot.trained ? ` (${trainedAi.modelName(robot.trainedModel)})` : ' bot')
            if (name != robot.name) {
                robot.name = name
                this.core.addUpdateDiff({ players: { [robot.index]: { name: name } } })
            }
        })
    }

    nextUnkicked(i) {
        return (i + 1) % this.size();
    }

    updateRounds(rounds, roundNumber) {
        this.emitAll('updaterounds', { rounds: rounds, roundNumber: roundNumber });
    }

    newGame() {
        for (let i = 0; i < this.size(); i++) {
            let player = this.players[i];
            player.index = i;
            player.newGameReset();
        }
        //this.emitAll('start');
        this.core.addUpdateDiff({ players: this.players.map(p => p.toDict()) })
    }

    newRound() {
        for (const player of this.players) {
            player.newRoundReset();
        }
    }

    giveHands(hands) {
        this.core.addUpdateDiff({ players: this.players.map(p => ({ hand: [] })) })
        this.core.flushDiffs()
        for (const player of this.players) {
            player.addHand(hands.hands[player.index]);
            this.core.addUpdateDiff({ players: hands.hands.map((h, i) => ({ hand: h.map(c => i == player.index ? c : new card.Card()) })) })
            this.core.flushDiffs([player])
        }
        this.core.addUpdateDiff({ players: hands.hands.map(h => ({ hand: h })) })
        this.core.flushDiffs(this.kibitzers)
    }

    sendDealerLeader(dealer, leader) {
        this.emitAll('dealerleader', { dealer: dealer, leader: leader });
    }

    bidSum() {
        let ans = 0;
        for (const player of this.players) {
            if (player.bidded) {
                ans += player.bid;
            }
        }
        return ans;
    }

    bidReport(index, bid, offset) {
        this.players[index].addBid(bid, offset);
    }

    playReport(index, card, isLead, follow) {
        this.players[index].addPlay(card, isLead, follow);
    }

    passReport(index, cards) {
        this.players[index].addPass(cards);
    }

    allHaveBid() {
        return !this.players.some(p => !p.bidded);
    }

    allHavePassed() {
        return !this.players.some(p => !p.passed);
    }

    allHavePlayed() {
        return !this.players.some(p => p.trick.isEmpty());
    }

    trickWinner(index) {
        this.players[index].incTaken(this.players.map(p => p.trick))

        for (const player of this.players) {
            player.newTrickReset();
        }
    }

    hasEmptyHand(index) {
        return this.players[index].hand.length == 0;
    }

    scoreRound() {
        let newScores = [];
        for (const player of this.players) {
            player.addTaken();
            let score = this.core.score(player);
            player.addScore(score);
            newScores.push(player.score);

            if (this.game.mode != 'Oh Hell') { //TODO
                continue;
            }

            player.mistakes.push(player.roundMistakes);

            let qs = player.bidQs[player.bidQs.length - 1];
            let mu = ai.pointsMean(qs, player.bid);
            let sig2 = ai.pointsVariance(qs, player.bid);

            let luck = Math.min(5, Math.max(-5,
                (score - mu) / Math.sqrt(sig2)
            ));
            player.addLuck(sig2 == 0 ? 0 : luck);
        }
    }

    performPass(offset) {
        let passedTo = new Array(this.players.length).fill(-1)
        for (const player of this.players) {
            if (player.pass.length == 0) {
                continue;
            }
            let i = (player.index + offset + this.players.length) % this.players.length
            while (i != player.index) {
                if (this.players[i].pass.length > 0) {
                    this.players[i].hand.push(...player.pass)
                    this.players[i].hand.sort((c1, c2) => c1.compSort(c2))
                    passedTo[player.index] = i;
                    break;
                }
                i = (i + offset + this.players.length) % this.players.length;
            }
        }

        for (let player of this.players.concat(this.kibitzers)) {
            this.core.addUpdateDiff(
                {
                    players: this.players.map(p => ({
                        passedTo: passedTo[p.index],
                        pass: player.index == passedTo[p.index] ? p.pass : undefined
                    }))
                },
                { performPass: true }
            )
            this.core.flushDiffs([player])

            if (!player.kibitzer && player.pass.length == 0) {
                continue
            }

            let removeDiff = { players: {} }
            for (let p of this.players) {
                removeDiff.players[p.index] = ['hand']
            }
            this.core.addRemoveDiff(removeDiff)
            this.core.addUpdateDiff(
                {
                    players: this.players.map(p => ({
                        hand: player.index == p.index || player.kibitzer ? p.hand : p.hand.map(c => new card.Card())
                    }))
                }
            )
            this.core.flushDiffs([player])
        }
    }

    addWbProbs(probs) {
        for (let i = 0; i < this.players.length; i++) {
            this.players[i].addWbProb(probs[i]);
        }
    }

    postGameData(coreData) {
        return {
            players: this.players.map(p => p.toPostGameDict()),
            teams: this.teams.map(t => t.toDict())
        };
    }

    sendPostGameData(coreData) {
        this.emitAll('postgame', coreData);
    }

    sendChat(index, text, recipient) {
        let sender
        if (index === undefined) {
            sender = 'System'
        } else {
            sender = this.players[index].name
        }
        if (recipient === undefined) {
            this.emitAll('chat', { sender: sender, text: text })
        } else {
            this.players[recipient].emit('chat', { sender: sender, text: text })
        }
    }

    sendEndGameRequest(index) {
        this.emitAll('end', { index: index });
    }

    replaceWithRobot(index) {
        this.players[index].replaceWithRobot();
        this.core.addUpdateDiff({ players: { [index]: { replacedByRobot: true } } })
        this.core.flushDiffs()
        //this.updatePlayers([this.players[index]]);
    }

    announceClaim(index) {
        for (const player of this.players) {
            player.startDecision({
                name: 'claim',
                prompt: `${this.players[index].name} claims the rest of the tricks.`,
                choices: player.index == index ? [] : ['Accept', 'Reject'],
                data: {
                    index: index,
                    hand: this.players[index].hand.map(c => c.toDict())
                }
            })
            this.core.addUpdateDiff({ players: { [player.index]: { decision: player.decision } } })
            this.core.flushDiffs([player])
        }

        this.core.addUpdateDiff({ players: { [index]: { hand: this.players[index].hand } } })
        this.core.flushDiffs(this.players.filter(p => p.index != index))
    }

    respondToClaim(index, accept) {
        if (this.players[index].decision === undefined) {
            return
        }

        if (!accept) {
            this.emitAll('claimresult', { accepted: false, claimer: this.core.claimer })

            for (const player of this.players) {
                player.acceptedClaim = false
                player.removeDecision()
                this.core.addRemoveDiff({ players: { [player.index]: ['decision'] } })
                this.core.flushDiffs([player])
            }

            this.core.addUpdateDiff({ players: { [this.core.claimer]: { hand: this.players[this.core.claimer].hand.map(c => new card.Card()) } } })
            this.core.flushDiffs(this.players.filter(p => p.index != this.core.claimer))

            this.core.claimer = undefined
            return
        }

        this.players[index].acceptedClaim = true;
        this.players[index].removeDecision();
        this.core.addRemoveDiff({ players: { [index]: ['decision'] } })
        this.core.flushDiffs([this.players[index]])

        if (!this.players.some(p => p.index != this.core.claimer && !p.acceptedClaim)) {
            for (const player of this.players) {
                player.acceptedClaim = false
                player.removeDecision()
                this.core.addRemoveDiff({ players: { [player.index]: ['decision'] } })
                this.core.flushDiffs([player])
            }

            this.core.acceptClaim();
        }
    }

    reteam(index, number) {
        if (number === undefined) {
            for (number = 0; number < 10 && this.teams[number].members.length != 0; number++)
                if (number == 10) {
                    return;
                }
        }

        this.players[index].team = number;
        this.core.addUpdateDiff({ players: { [index]: { team: number } } })
        //this.updatePlayers([this.players[index]]);
        this.updateTeams();
        this.core.flushDiffs()
    }

    renameTeam(number, name) {
        this.teams[number].name = name
        this.core.addUpdateDiff({ teams: { [number]: { name: name } } })
        this.core.flushDiffs()
    }

    scrambleTeams() {
        let properDivisors = [];
        for (let i = 2; i < this.size(); i++) {
            if (this.size() % i == 0) {
                properDivisors.push(i);
            }
        }
        if (properDivisors.length > 0) {
            let numTeams = properDivisors[Math.floor(Math.random() * properDivisors.length)];
            let playersPerTeam = this.size() / numTeams;
            let playersToChoose = this.players.map(p => p);
            for (let i = 0; i < numTeams; i++) {
                for (let j = 0; j < playersPerTeam; j++) {
                    playersToChoose.splice(Math.floor(Math.random() * playersToChoose.length), 1)[0].team = i;
                }
            }

            //this.updatePlayers(this.players);
            this.core.addUpdateDiff({ players: this.players.map(p => ({ team: p.team })) })
            this.updateTeams();
            this.core.flushDiffs()
        }
    }

    updateTeams() {
        for (const team of this.teams) {
            team.buildMembers();
        }
        this.core.addRemoveDiff({ teams: null })
        this.core.addUpdateDiff({ teams: this.teams.map(t => t.toDict()) })
        //let data = {teams: this.teams.map(t => t.toDict())};
        //for (const list of [this.players, this.kibitzers]) {
        //    for (const p of list) {
        //        p.commandUpdateTeams(data);
        //    }
        //}
    }

    flushDiffs(players, immediate) {
        if (!players) {
            for (let player of this.players) {
                player.flushDiffs(this.core.diffs, immediate)
            }
            for (let player of this.kibitzers) {
                player.flushDiffs(this.core.diffs, immediate)
            }
        }
        else {
            for (let player of players) {
                player.flushDiffs(this.core.diffs, immediate)
            }
        }
    }
}

class Team {
    constructor(number, players) {
        this.number = number;
        this.players = players;
        this.resetName();
    }

    toDict() {
        return {
            number: this.number,
            name: this.name,
            members: this.members.map(p => p.index)
        };
    }

    resetName() {
        this.name = 'Team ' + (this.number + 1);
    }

    buildMembers() {
        this.members = this.players.players.filter(p => p.team == this.number);
    }

    bid() {
        if (this.members.length == 0) {
            return 0;
        } else {
            return this.members.map(p => p.bid).reduce((a, b) => a + b, 0);
        }
    }

    taken() {
        if (this.members.length == 0) {
            return 0;
        } else {
            return this.members.map(p => p.taken).reduce((a, b) => a + b, 0);
        }
    }
}

class Options {
    constructor(options) {
        this.robots = 0;
        this.trainedRobots = 0;
        this.trainedModels = [];  // per AI Trained bot: a trained_ai catalog id
        this.D = 1;
        this.teams = false;
        this.oregon = false;
    }

    toDict() {
        return {
            robots: this.robots,
            trainedRobots: this.trainedRobots,
            trainedModels: this.trainedModels,
            // (what the menus offer: [{id, name, decks: {"1": [players...], "2": [...]}}])
            trainedCatalog: trainedAi.catalog().models,
            D: this.D,
            teams: this.teams,
            oregon: this.oregon
        };
    }

    update(options) {
        this.robots = parseInt(options.robots);
        this.trainedRobots = Math.max(0, Math.min(parseInt(options.trainedRobots) || 0, this.robots));
        const known = new Set(trainedAi.catalog().models.map(m => m.id));
        this.trainedModels = (Array.isArray(options.trainedModels) ? options.trainedModels : [])
            .slice(0, this.trainedRobots).map(id => known.has(id) ? id : trainedAi.DEFAULT_MODEL);
        this.D = options.D;
        this.teams = options.teams;
        this.oregon = options.oregon;
    }
}

class Core {
    constructor(players, game, options) {
        this.players = players;
        this.game = game;
        players.core = this;
        this.diffs = []
        this.options = new Options()
        this.updateOptions(options)
    }

    addUpdateDiff(data, args) {
        this.diffs.push({ type: 'update', data: data, args: args })
    }

    addRemoveDiff(data, args) {
        this.diffs.push({ type: 'remove', data: data, args: args })
    }

    flushDiffs(players) {
        if (this.diffs.length == 0) {
            return
        }
        this.players.flushDiffs(players)
        this.diffs = []
    }

    updateOptions(options) {
        this.options.update(options);
        this.addUpdateDiff({ 'options': this.options })
        this.players.updateOptions(this.options);
        this.flushDiffs()
    }

    createHumanPlayer(user) {
        return new (createHumanPlayer(Player))(user, this)
    }

    createAiPlayer(number) {
        return new (createAiPlayer(Player))(number, this)
    }

    startGame() {
        if (!this.verifyGameCanStart()) {
            return;
        }

        try {
            this.attachStrategyModules()
        }
        catch (err) {
            log('Error loading strategy modules:')
            log(err)
            return
        }
        this.randomizePlayerOrder();

        this.buildRounds();
        this.roundNumber = 0;
        this.playNumber = 0;
        this.updateRounds();

        this.players.newGame();
        this.flushDiffs()

        this.trumps = [];
        this.leaders = [];
        this.winners = [];
        this.claims = [];
        this.deck = new card.Deck(this.options.D);

        this.json = undefined

        //if (debug) {
        //    var sample = require('./sample');
        //    this.fullDeals = sample.sample.map(ds => ds.map(h => h.map(c => new card.Card().fromString(c))));
        //}

        this.transitionFromStart();
    }

    endGame(index) {
        if (index != this.game.host.index) {
            log('ERROR: Player "' + this.players.get(index).id + '" tried to end the game, but they are not host.');
            return;
        }

        this.players.sendEndGameRequest(index);
        this.sendPostGame();
    }

    randomizePlayerOrder() {
        this.players.randomizePlayerOrder()
    }

    attachStrategyModules() {
        let T = this.players.teams.filter(t => t.members.length > 0).length;
        let modules = ai.buildStrategyModules(
            this.game.mode,
            {
                N: this.players.size(),
                D: this.options.D,
                T: this.options.teams ? T : 0,
                trained: this.players.players.map(p => p.trained === true ? p.trainedModel : null)
            }
        );
        this.players.attachStrategyModules(modules);
    }

    updateRounds() {
        let dIndex = this.players.nextUnkicked(-1);
        for (const round of this.rounds) {
            round.dealer = dIndex;
            dIndex = this.players.nextUnkicked(dIndex);
        }

        this.addRemoveDiff({ 'rounds': null })
        this.addUpdateDiff({ rounds: this.rounds, roundNumber: this.roundNumber })
    }

    getDealer() {
        return this.rounds[this.roundNumber].dealer;
    }

    getHandSize() {
        return this.rounds[this.roundNumber].handSize;
    }

    sendDealerLeader() {
        this.players.sendDealerLeader(this.getDealer(), this.leader);
    }

    deal() {
        this.deck.initialize();

        let hands = this.getNextHands();

        this.trump = hands.trump[0];
        this.trumps.push(this.trump);

        this.turn = this.players.nextUnkicked(this.getDealer());
        this.leader = this.turn;

        this.addUpdateDiff({ trump: this.trump, leader: this.leader })

        this.leaders.push([]);
        this.winners.push([]);

        this.players.newRound();
        this.addUpdateDiff({
            players: this.players.players.map(p => ({
                bid: 0,
                taken: 0,
                bidded: false,
                pass: [],
                passed: false,
                trick: new card.Card(),
                played: false,
                lastTrick: new card.Card()
            }))
        })
        //this.sendDealerLeader();

        this.flushDiffs()
        this.players.giveHands(hands);

        this.playNumber = 0;

        this.transitionFromDeal();
    }

    finishRound() {
        this.claimer = undefined
        this.players.scoreRound();
        this.rounds[this.roundNumber].isOver = true;
        this.roundNumber++;

        this.addUpdateDiff({
            roundNumber: this.roundNumber,
            players: this.players.players.map(p => ({
                takens: { [p.takens.length - 1]: p.takens[p.takens.length - 1] },
                score: p.score,
                scores: { [p.scores.length - 1]: p.score }
            }))
        })
        this.flushDiffs()
        this.players.emitAll('showroundmessage')

        this.transitionFromRoundEnd();
    }

    incomingChat(index, text) {
        this.players.sendChat(index, text);
    }

    replaceWithRobot(player, indexTarget) {
        if (!player.host || !this.players.get(indexTarget).disconnected) {
            return;
        }

        this.players.replaceWithRobot(indexTarget);
    }

    poke(index) {
        if (!this.players.players[index]) {
            return
        }

        this.players.players[index].poke();
    }

    enableClaimRequest() { return false }

    incomingClaim(index) {
        if (!this.enableClaimRequest()) {
            return;
        }

        this.claimer = index;
        this.players.announceClaim(index);

        //this.makeDecision(index, {name: 'claim', choice: 0}); // claimer auto-accepts
    }

    acceptClaim() {
        this.claims.push(this.claimer);
        this.claimAccepted();
    }

    claimAccepted() {
        this.finishRound();
    }

    makeDecision(index, data) { }

    reteam(requester, index, number) {
        if ((requester.kibitzer || requester.index != index) && !requester.host) {
            log('ERROR: Player "' + requester.id + '" attempted to reteam someone else, but they are not host.');
            return;
        }

        this.players.reteam(index, number);
    }

    renameTeam(requester, number, team) {
        this.players.renameTeam(number, team);
    }

    scrambleTeams(requester) {
        //if (debug) {
        //    this.players.reteam(1, 1);
        //    this.players.reteam(2, 0);
        //    this.players.reteam(3, 2);
        //    this.players.reteam(4, 1);
        //    this.players.reteam(5, 2);
        //    this.players.reteam(0, 0);
        //    return;
        //}

        if (!requester.host) {
            log('ERROR: Player "' + requester.id + '" attempted to scramble teams, but they are not host.');
            return;
        }

        this.players.scrambleTeams();
    }

    // standard
    whatCanIPlay(index) {
        let led = this.trickOrder.getLed();
        let hand = this.players.players[index].hand;
        if (led == -1) {
            return hand;
        } else {
            let ans = hand.filter(c => c.suit == led);
            if (ans.length == 0) {
                return hand;
            } else {
                return ans;
            }
        }
    }

    getTrump() {
        return this.trump;
    }

    getLeader() {
        return this.leader;
    }

    getLead() {
        return this.players.players[this.leader].trick;
    }
}

class TrickOrder {
    constructor(trump) {
        this.order = [];
        this.trump = trump;
        this.led = -1;
        this.leader = undefined;
    }

    copy() {
        let ans = new TrickOrder(this.trump);
        ans.led = this.led;
        ans.leader = this.leader;
        ans.order = this.order.map(e => e);
        return ans;
    }

    getLed() {
        return this.led;
    }

    push(card, index) {
        let entry = { card: card, index: index };

        if (this.led == -1) {
            this.order.push(entry);
            this.led = card.suit;
            this.leader = index;
            return;
        }

        if (card.suit != this.led && card.suit != this.trump) {
            return;
        }

        for (let i = 0; i < this.order.length; i++) {
            let comp = card.comp(this.order[i].card, this.trump, this.led);
            if (comp < 0) {
                continue;
            } else if (comp > 0) {
                this.order.splice(i, 0, entry);
                return;
            } else {
                this.order.splice(i, 1);
                return;
            }
        }
        this.order.push(entry);
    }

    getWinner() {
        if (this.order.length == 0) {
            return this.leader;
        } else {
            return this.order[0].index;
        }
    }
}

module.exports = {
    Core: Core,
    PlayersList: PlayersList,
    Player: Player,
    createHumanPlayer: createHumanPlayer,
    createAiPlayer: createAiPlayer,
    TrickOrder: TrickOrder
}