import {
    font, colors, smallCardScale, getStringDimensions, drawText, drawBox, drawOval, createDeckImg, drawCard, drawLine, enableButton, disableButton
} from '../graphics_tools.js'

import {
    CanvasInteractable, WrappedDOMElement, PanelInteractable, CanvasButton, PlayerNamePlate, CanvasCard
} from '../interactable.js'

import { TimerEntry, OhcCanvas } from '../canvas.js'

import { ScoreSheet } from '../scoresheet.js'

import { PostGamePage } from '../postgame.js'

import { ClientStateGameBase, createClientStatePreGame, createClientStatePlaying, createClientStatePostGame, CanvasBase } from './base.js'

// basics

export class Pass {
    constructor(N) {
        this.clear();
        this.toPass = [0, 0, 0, 4, 3, 2, 2, 2, 1][N];
    }

    clear() {
        this.list = [];
        this.set = new Set();
    }

    deselect(card) {
        this.list = this.list.filter(c => c !== card);
        this.set.delete(card);
    }

    select(card) {
        while (this.list.length >= this.toPass) {
            this.deselect(this.list[0]);
        }
        this.list.push(card);
        this.set.add(card);
    }

    isSelected(card) {
        return this.set.has(card);
    }
}

// states

export class ClientStateHearts extends ClientStateGameBase {
    constructor(key, client, div) {
        super(key, 'HEARTS_BASE', client, div, key == 'HEARTS_BASE' ? HeartsCanvas : undefined)
    }

    initialize() {
        super.initialize()
        this.passTimer = 1
        this.sortScoresDescending = false
    }

    updateServerData_options(type, diff) {
        let options = this.baseState.serverData.options
        if (options.robots !== undefined) {
            this.canvas.robotsSpinner.value = options.robots
        }
        if (options.oregon !== undefined) {
            this.canvas.oregonCheckBox.checked = options.oregon
        }
    }

    paintPassButton() { return false }
    paintPass() { return false }
    cardSelected(card) { return card.preselection != undefined || this.pass && this.pass.isSelected(card.getCard()) }
}

export class ClientStateHeartsPreGame extends createClientStatePreGame(ClientStateHearts) {
    constructor(key, client) {
        super(key, client)
    }

    enter(data) {
        super.enter(data)
        document.getElementById("doubleDeckOptionsRow").style.display = 'none'
        document.getElementById("trainedOptionsRow").style.display = 'none'
        document.getElementById("trainedModelsRow").style.display = 'none'
        document.getElementById("teamsOptionsRow").style.display = 'none'
    }

    reteam(index, team) { }
    scrambleTeams() { }
}

export class ClientStateHeartsPassing extends ClientStateHearts {
    constructor(key, client) {
        super(key, client, document.getElementById('inGameDiv'))
    }

    initialize() {
        this.baseState = this.client.stateCache[this.baseKey]
    }

    animatePass() {
        this.pushBasicTimer(() => { }, this.client.vars.bidStayTime, true)

        let animateTe = new TimerEntry(this.client.vars.animationTime)
        animateTe.onAction = () => this.client.state.baseState.passTimer = Math.min(animateTe.elapsedTime / this.client.vars.animationTime, 1)
        this.canvas.pushTimerEntry(animateTe, true)

        this.pushBasicTimer(() => { }, this.client.vars.bidStayTime, true)
    }

    updateServerData_state(type, diff) {
        super.updateServerData_state(type, diff)
    }

    updateServerData_players(type, diff) {
        super.updateServerData_players(type, diff)

        let state = this
        function handlePass(index, player) {
            if (type == 'remove' && player.hand && player.hand.length > 0 && index == state.baseState.myPlayer.index && !state.baseState.myPlayer.kibitzer) {
                // We need to splice because state.canvas.cardInteractables needs to be referencing the same object before and after
                player.hand.sort((i1, i2) => i1 < i2 ? 1 : -1)
                player.hand.forEach(i => state.canvas.cardInteractables.splice(i, 1))
            }
        }
        if (Array.isArray(diff.players)) {
            for (let i = 0; i < diff.players.length; i++) {
                handlePass(i, diff.players[i])
            }
        } else {
            for (let [i, player] of Object.entries(diff.players)) {
                handlePass(i, player)
            }
        }
    }

    updateServerDataArgs_performPass(type, diff) {
        this.animatePass()
    }

    enter(data) {
        super.enter(data)
        this.baseState.passTimer = 0
        this.pass = new Pass(this.baseState.serverData.players.length)
    }

    clickOnNothing() {
        this.pass.clear()
    }

    adjustDivSizes() { this.canvas.fixScoreWidth() }
    paintPlayers() { return true }
    paintTaken() { return true }
    paintCornerButtons() { return true }
    paintPreselected() { return true }
    paintNamePlates() { return true }
    highlightPlayer(player) { return !player.passed }
    enablePoking(player) { return this.highlightPlayer(player) }
    paintScoreSheet() { return true }
    cardEnabled(card) { return !this.baseState.myPlayer.bidded }
    paintHandInteractables() { return true }
    checkIfShouldPlayPreselected() { return true }
    paintPassButton() { return !this.baseState.myPlayer.passed && !this.baseState.myPlayer.kibitzer }
    paintPass() { return true }

    canPlayCard(card) { return true }
    playCard(card) {
        if (this.baseState.myPlayer.passed) {
            return
        }
        if (this.pass.isSelected(card.getCard())) {
            this.pass.deselect(card.getCard())
        } else {
            this.pass.select(card.getCard())
        }
    }

    makePass(cards) {
        this.client.emit('pass', { cards: cards })
    }
}

export class ClientStateHeartsPlaying extends createClientStatePlaying(ClientStateHearts) {
    constructor(key, client) {
        super(key, client)
    }
}

export class ClientStateHeartsPostGame extends createClientStatePostGame(ClientStateHearts) {
    constructor(key, client) {
        super(key, client)
    }
}

// canvas

class HeartsCanvas extends CanvasBase {
    constructor(client) {
        super(client)
    }

    initialize() {
        if (this.initialized) {
            return
        }
        super.initialize()

        // listeners
        this.robotsSpinner = document.getElementById("igRobots")
        this.robotsSpinner.addEventListener('change', () => { this.client.state.sendOptionsUpdate({ robots: this.robotsSpinner.value }) })

        this.oregonCheckBox = document.getElementById("igOregon")
        this.oregonCheckBox.addEventListener('change', () => { this.client.state.sendOptionsUpdate({ oregon: this.oregonCheckBox.checked }) })

        igLobby.addEventListener('click', () => this.client.changeState('HEARTS_PREGAME'))

        // filled out statically
        class HeartsScoreSheet extends ScoreSheet {
            constructor(prefix, canvas) { super(prefix, canvas) }

            paintRoundLabels(ctx) {
                // dealers and hand sizes
                for (let i = 0; i < this.rounds.length; i++) {
                    let round = this.rounds[i];

                    let info = ''
                    if (round.pass == 0) {
                        info = 'K';
                    } else if (round.pass > 0) {
                        info = 'L';
                        if (round.pass > 1) {
                            info += round.pass;
                        }
                    } else if (round.pass < 0) {
                        info = 'R';
                        if (round.pass < -1) {
                            info += (-round.pass);
                        }
                    }

                    drawText(ctx,
                        info,
                        this.margin + this.dealerHWidth / 2,
                        this.scoreVSpacing * (i + 0.5),
                        1, 1,
                        font.basic, 'black'
                    )
                    drawText(ctx,
                        this.playersUnsorted[round.dealer].name.substring(0, 1),
                        2 * this.margin + 1.5 * this.dealerHWidth,
                        this.scoreVSpacing * (i + 0.5),
                        1, 1,
                        font.basic, 'black'
                    )
                }
            }
        }
        this.scoreSheet = new HeartsScoreSheet('ig', this);
        this.scoreSheet.x = () => this.client.cachedWidth - (this.client.state.baseState.getScoreWidth() - this.scoreSheet.scoreMargin)
        this.scoreSheet.y = () => this.scoreSheet.scoreMargin
        this.scoreSheet.width = () => this.client.state.baseState.getScoreWidth() - 2 * this.scoreSheet.scoreMargin
        this.scoreSheet.getPlayers = () => this.scoreSheetPlayers();
        this.scoreSheet.getTeams = () => this.scoreSheetTeams();
        this.scoreSheet.getRounds = () => this.scoreSheetRounds();
        this.scoreSheet.getOptions = () => this.scoreSheetOptions();
        this.scoreSheet.container = () => this.client.state.scoreSheetContainer()
        this.scoreSheet.isShown = () => this.client.state.paintScoreSheet()

        let passB = document.createElement('button');
        passB.innerHTML = 'Pass';
        passB.classList.add(
            'bg-white', 'rounded-lg', 'border', 'border-black', 'w-5', 'h-5',
            'font-bold', 'text-md', 'select-none', 'hover:bg-gray-300'
        );
        passB.addEventListener('click', () => this.client.state.makePass(this.client.state.pass.list));
        this.passButton = new WrappedDOMElement(passB);
        this.passButton.x = () =>
            (this.client.cachedWidth - this.client.state.baseState.getScoreWidth()) / 2 - (this.client.state.baseState.serverData.options.oregon ? 100 : 45);
        this.passButton.y = () => this.client.cachedHeight - 310;
        this.passButton.width = () => 90;
        this.passButton.height = () => 30;
        this.passButton.container = () => document.getElementById('inGameDiv');
        this.passButton.isShown = () => this.client.state.paintPassButton()
        this.passButton.isEnabled = () => this.client.state.pass.list.length == this.client.state.pass.toPass
        this.passButton.click = () => { }; // so cards don't deselect

        let abstainB = document.createElement('button');
        abstainB.innerHTML = 'Abstain';
        abstainB.classList.add(
            'bg-white', 'rounded-lg', 'border', 'border-black', 'w-5', 'h-5',
            'font-bold', 'text-md', 'select-none', 'hover:bg-gray-300'
        );
        abstainB.addEventListener('click', () => this.client.state.makePass([]));
        this.abstainButton = new WrappedDOMElement(abstainB);
        this.abstainButton.x = () => (this.client.cachedWidth - this.client.state.baseState.getScoreWidth()) / 2 + 10;
        this.abstainButton.y = () => this.client.cachedHeight - 310;
        this.abstainButton.width = () => 90;
        this.abstainButton.height = () => 30;
        this.abstainButton.container = () => document.getElementById('inGameDiv');
        this.abstainButton.isShown = () => this.client.state.paintPassButton() && this.client.state.baseState.serverData.options.oregon
        this.abstainButton.isEnabled = () => this.client.state.baseState.serverData.options.oregon
        this.abstainButton.click = () => { }; // so cards don't deselect

        this.postGamePage = new PostGamePage(this);

        this.interactables = this.interactables.concat([
            [this.scoreSheet],
            [this.passButton, this.abstainButton]
        ])
    }

    customPaintFirst() {
        super.customPaintFirst()
        this.paintPass()
    }

    updateHostOptions() {
        if (!this.client.state.baseState.myPlayer) {
            return
        }
        if (!this.client.state.baseState.myPlayer.host) {
            this.robotsSpinner.disabled = true
            this.oregonCheckBox.disabled = true
            disableButton(this.igStart)
        } else {
            this.robotsSpinner.disabled = false
            this.oregonCheckBox.disabled = false
            enableButton(this.igStart)
        }
    }

    paintPass() {
        if (!this.client.state.paintPass()) {
            return
        }

        let separation = 10
        for (const player of this.client.state.baseState.serverData.players) {
            if (player.passed) {
                let startX = player.getPassX();
                let startY = player.getPassY();

                let passedTo = player.index;
                if (player.passedTo !== undefined && player.passedTo != -1) {
                    passedTo = player.passedTo;
                }

                let endX = this.client.state.baseState.serverData.players[passedTo].getPassX();
                let endY = this.client.state.baseState.serverData.players[passedTo].getPassY();

                let t = this.client.state.baseState.passTimer
                let x = t * endX + (1 - t) * startX;
                let y = t * endY + (1 - t) * startY;

                for (let i = 0; i < player.pass.length; i++) {
                    drawCard(this.client.ctx,
                        player.pass[i],
                        x + (i - (player.pass.length - 1) / 2) * separation,
                        y,
                        smallCardScale, this.client.vars.deckImgSmall, false, -1, undefined
                    );
                }
            }
        }
    }

    createPostGamePage() {
        return new HeartsPostGamePage(this)
    }

    loadPostGame(data) {
        //data.trumps = data.trumps.map(c => new Card(c.num, c.suit))

        this.pgPlayers = data.players
        this.pgTeams = data.teams
        this.pgRounds = data.rounds
        this.pgOptions = data.options

        this.postGamePage.setData(data)
    }
}

class HeartsPostGamePage extends PostGamePage {
    constructor(canvas) {
        super(canvas)
    }
}