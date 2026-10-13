// Plays full Oh Hell matches between robots in Games2's real game engine
// (OhHellCore, no server or sockets): some robots with the trained model, the rest
// with the built-in AI. Checks nothing crashes and reports scores and wins.
//
//   node trained_ai/tools/headless_match.js [players=4] [trainedRobots=2] [matches=4]
//        [decks=1] [models=champion,...]   (models: one catalog id per trained-AI robot,
//                                           cycled; "all" = every model for this table)
//
// Run from web/. The euchre native add-on (unused by Oh Hell) is stubbed if it
// hasn't been built.
const Module = require('module');
const path = require('path');
const webDir = path.join(__dirname, '..', '..');
process.chdir(webDir);

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request.endsWith('build/Release/euchre')) {
        try { return origLoad.apply(this, arguments); } catch (e) { return {}; }
    }
    return origLoad.apply(this, arguments);
};

// Same modules as index.js (hearts.js sets the global `card` that oh_hell.js uses).
const core = require(path.join(webDir, 'core.js'));
const ohHell = require(path.join(webDir, 'oh_hell.js'));
require(path.join(webDir, 'hearts.js'));
require(path.join(webDir, 'euchre.js'));

const N = parseInt(process.argv[2] || '4');
const K = parseInt(process.argv[3] || '2');
const M = parseInt(process.argv[4] || '4');
const D = parseInt(process.argv[5] || '1');
const trainedAi = require(path.join(webDir, 'trained_ai', 'strategy.js'));
let MODELS = (process.argv[6] || 'champion').split(',');
if (MODELS[0] == 'all') MODELS = trainedAi.modelsFor(N, D).map(m => m.id);
const models = Array.from({ length: K }, (_, k) => MODELS[k % MODELS.length]);

function playMatch() {
    return new Promise((resolve, reject) => {
        const game = { mode: 'Oh Hell', stopExpirationTimer() {}, startExpirationTimer() {} };
        const players = new core.PlayersList(game);
        const options = { robots: 0, trainedRobots: 0, D: 1, teams: false, oregon: false };
        const c = new ohHell.OhHellCore(players, game, options);
        c.updateOptions({ robots: N, trainedRobots: K, trainedModels: models, D: D, teams: false,
                          oregon: false });
        c.sendPostGame = function () {
            try {
                resolve(players.players.map(p => ({
                    name: p.name, trained: p.trained === true, score: p.score,
                    module: p.strategyModule.constructor.name +
                        (p.strategyModule.modelId ? ':' + p.strategyModule.modelId : ''),
                })));
            } catch (e) { reject(e); }
        };
        setTimeout(() => reject(new Error('match stalled (an illegal move?)')), 120000).unref();
        process.once('uncaughtException', reject);
        process.once('unhandledRejection', reject);
        c.startGame();
    });
}

(async () => {
    const totals = { trained: [0, 0, 0], builtin: [0, 0, 0] };  // [points, wins, seats]
    for (let m = 0; m < M; m++) {
        const res = await playMatch();
        const best = Math.max(...res.map(r => r.score));
        const winners = res.filter(r => r.score == best).length;
        for (const r of res) {
            const t = totals[r.trained ? 'trained' : 'builtin'];
            t[0] += r.score;
            t[1] += r.score == best ? 1 / winners : 0;
            t[2] += 1;
        }
        console.log(`match ${m + 1}: ` + res.map(r => `${r.name} [${r.module}] ${r.score}`).join(', '));
    }
    for (const [k, [pts, wins, seats]] of Object.entries(totals)) {
        if (seats) {
            console.log(`${k}: ${seats} seats, mean score ${(pts / seats).toFixed(1)}, ` +
                        `wins ${wins.toFixed(1)} (${(100 * wins / M).toFixed(0)}% of matches)`);
        }
    }
    process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
