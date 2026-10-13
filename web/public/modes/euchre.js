import { Card } from '../basics.js'

import {
    adjustedStyle, font, colors, smallCardScale, getStringDimensions, drawText, drawBox, drawOval, createDeckImg, drawCard, drawLine, enableButton, disableButton, toggleButton
} from '../graphics_tools.js'

import {
    CanvasInteractable, WrappedDOMElement, PanelInteractable, CanvasButton, PlayerNamePlate, CanvasCard
} from '../interactable.js'

import { TimerEntry, OhcCanvas } from '../canvas.js'

import { PostGamePage, PostGameTab, PostGamePlotTab } from '../postgame.js'

import { ClientStateGameBase, createClientStatePreGame, createClientStatePlaying, createClientStatePostGame, CanvasBase } from './base.js'

// states

export class ClientStateEuchre extends ClientStateGameBase {
    constructor(key, client, div) {
        super(key, 'EUCHRE_BASE', client, div, key == 'EUCHRE_BASE' ? EuchreCanvas : undefined)
    }

    initialize() {
        super.initialize()
        this.trumpTimer = 1
        this.pickUpTimer = 0
        this.showDespacito = false
        this.despacitoCooldown = 60000
        this.despacitoTime = 0
    }

    updateServerData_options(type, diff) {
        let options = this.baseState.serverData.options
        if (options.robots !== undefined) {
            this.canvas.robotsSpinner.value = options.robots
        }
    }

    chat(data) {
        super.chat(data)
        if (data.text == `${data.sender}: despacito`) {
            this.playDespacito()
        }
    }

    playDespacito() {
        let now = new Date().getTime()

        if (now < this.baseState.despacitoTime) {
            let waitTime = Math.max(Math.floor((this.baseState.despacitoTime - now) / 1000), 1)
            this.canvas.chat({ sender: 'System', text: `Wait ${waitTime} seconds before spamming Despacito.` })
            return
        }
        this.baseState.despacitoTime = now + this.baseState.despacitoCooldown

        let duration = 10
        let startTime = Math.floor(Math.random() * (250 - duration - 1))
        let endTime = startTime + duration + 1

        let ytTe = new TimerEntry(duration * 1000)
        ytTe.onFirstAction = () => {
            this.canvas.despacito.start(startTime, endTime)
            this.baseState.showDespacito = true
        }
        ytTe.onLastAction = () => {
            this.canvas.despacito.stop()
            this.baseState.showDespacito = false
        }
        this.canvas.pushTimerEntry(ytTe, true)
    }

    paintUpCard() { return false }
    upCardIsDown() { return true }
    upCardIsDrawn() { return false }
    paintTrumpInteractables() { return false }
    paintDespacito() { return this.baseState.showDespacito }
}

export class ClientStateEuchrePreGame extends createClientStatePreGame(ClientStateEuchre) {
    constructor(key, client) {
        super(key, client)
    }

    enter(data) {
        super.enter(data)
        document.getElementById("doubleDeckOptionsRow").style.display = 'none'
        document.getElementById("trainedOptionsRow").style.display = 'none'
        document.getElementById("trainedModelsRow").style.display = 'none'
        document.getElementById("teamsOptionsRow").style.display = 'none'
        document.getElementById("oregonOptionsRow").style.display = 'none'
    }

    reteam(index, team) { }
    scrambleTeams() { }
}

export class ClientStateEuchreTrump extends ClientStateEuchre {
    constructor(key, client) {
        super(key, client, document.getElementById('inGameDiv'))
    }

    initialize() {
        this.baseState = this.client.stateCache[this.baseKey]
    }

    enter(data) {
        super.enter(data)
        this.baseState.preselected.clear(0)
        this.baseState.trumpTimer = 0
    }

    animateTrump() {
        let animateTe = new TimerEntry(this.client.vars.animationTime);
        animateTe.onAction = () => {
            this.baseState.trumpTimer = Math.min(animateTe.elapsedTime / this.client.vars.animationTime, 1)
        }
        this.canvas.pushTimerEntry(animateTe, true);

        let stayTe = new TimerEntry(this.client.vars.bidStayTime);
        this.canvas.pushTimerEntry(stayTe, true);

        let bufferTe = new TimerEntry(0);
        this.canvas.pushTimerEntry(bufferTe, true);
    }

    updateServerData_phase(type, diff) {
        if (diff.phase == 1) {
            this.pushBasicTimer(() => { }, this.client.vars.phaseChangeTime, true)
        }
    }

    updateServerData_declarer(type, diff) {
        this.animateTrump()
    }

    updateServerDataArgs_resort(type, args) {
        if (!this.baseState.myPlayer.kibitzer) {
            this.canvas.makeHandInteractables()
        }
    }

    adjustDivSizes() { this.canvas.fixScoreWidth() }
    paintPlayers() { return true }
    paintCornerButtons() { return true }
    paintPreselected() { return true }
    paintNamePlates() { return true }
    highlightPlayer(player) { return player.index == this.baseState.serverData.turn }
    enablePoking(player) { return this.highlightPlayer(player) }
    cardEnabled(card) { return this.baseState.myPlayer.bidded || !this.isItMyTurn() }
    paintHandInteractables() { return true }
    checkIfShouldPlayPreselected() { return this.isItMyTurn() }
    canPlayCard(card) { return false }
    paintUpCard() { return true }
    upCardIsDown() { return this.baseState.serverData.phase == 1 }
    paintTrumpInteractables() { return this.isItMyTurn() }
    getTrumpChoices() {
        let serverData = this.baseState.serverData
        let ans = []
        if (!(serverData.turn == serverData.rounds[serverData.roundNumber].dealer && serverData.phase == 1)) {
            ans.push({ pass: true, suit: -1, alone: false })
        }
        if (serverData.phase == 0) {
            ans.push({ pass: false, suit: serverData.upCard.suit, alone: false })
            ans.push({ pass: false, suit: serverData.upCard.suit, alone: true })
        } else {
            for (let i = 0; i < 4; i++) {
                if (i == serverData.upCard.suit) {
                    continue
                }
                ans.push({ pass: false, suit: i, alone: false })
                ans.push({ pass: false, suit: i, alone: true })
            }
        }
        return ans
    }
    paintScoreSheet() { return true }

    makeTrumpChoice(choice) {
        this.client.emit('trumpChoice', choice)
    }
}

export class ClientStateEuchreDiscard extends ClientStateEuchre {
    constructor(key, client) {
        super(key, client, document.getElementById('inGameDiv'))
    }

    initialize() {
        this.baseState = this.client.stateCache[this.baseKey]
    }

    animatePickUp(reverse) {
        let animateTe = new TimerEntry(this.client.vars.animationTime);
        animateTe.onAction = () => {
            this.baseState.pickUpTimer = reverse + (1 - 2 * reverse) * Math.min(animateTe.elapsedTime / this.client.vars.animationTime, 1)
        }
        animateTe.onLastAction = () => this.pickedUp = true
        this.canvas.pushTimerEntry(animateTe, true);
    }

    enter(data) {
        super.enter(data)
        this.discarded = false
        this.pickedUp = false
        this.animatePickUp(0)
    }

    exit(data) {
        super.exit(data)
        this.animatePickUp(1)
    }

    dealer() { return this.baseState.serverData.rounds[this.baseState.serverData.roundNumber].dealer }
    isItMyTurn() { return this.baseState.myPlayer.index == this.dealer() && !this.baseState.myPlayer.kibitzer }

    adjustDivSizes() { this.canvas.fixScoreWidth() }
    paintPlayers() { return true }
    paintCornerButtons() { return true }
    paintPreselected() { return true }
    paintNamePlates() { return true }
    highlightPlayer(player) { return player.index == this.dealer() }
    enablePoking(player) { return player.index == this.dealer() }
    cardEnabled(card) { return true }
    paintHandInteractables() { return true }
    checkIfShouldPlayPreselected() { return this.isItMyTurn() && !this.discarded }
    paintUpCard() { return true }
    upCardIsDown() { return this.pickedUp }
    upCardIsDrawn() { return this.baseState.pickUpTimer == 1 }
    paintScoreSheet() { return true }

    canPlayCard(card) {
        return true
    }
    playCard(canvasCard) {
        this.discarded = true
        this.client.emit('discard', canvasCard.getCard())
    }
}

export class ClientStateEuchrePlaying extends createClientStatePlaying(ClientStateEuchre) {
    constructor(key, client) {
        super(key, client)
    }

    paintUpCard() { return true }
    paintScoreSheet() { return true }

    showroundmessage() {
        let te = new TimerEntry(this.client.vars.messageTimeLong)
        te.onFirstAction = () => {
            let weDeclared = this.baseState.serverData.declarer % 2 == this.baseState.myPlayer.index % 2
            switch (this.baseState.serverData.roundResult) {
            case 0:
                if (weDeclared) {
                    this.baseState.message = 'You got euchred!'
                } else {
                    this.baseState.message = 'You euchred them!'
                }
                break
            case 1:
                if (weDeclared) {
                    this.baseState.message = 'You made it!'
                } else {
                    this.baseState.message = 'They made it!'
                }
                break
            case 2:
                if (weDeclared) {
                    this.baseState.message = 'You made them all!'
                } else {
                    this.baseState.message = 'They made them all!'
                }
                break
            }
        }
        te.onLastAction = () => {
            this.baseState.message = ''
        }
        this.canvas.pushTimerEntry(te)
    }
}

export class ClientStateEuchrePostGame extends createClientStatePostGame(ClientStateEuchre) {
    constructor(key, client) {
        super(key, client)
    }
}

// canvas

function formatTrumpChoice(choice) {
    let color = '#000000'
    let text = ''
    let width = 130
    let height = 50
    if (choice.pass) {
        text = 'Pass'
    } else {
        width = 50
        color = ['#000000', '#ff0000', '#000000', '#ff0000'][choice.suit]
        text = ['\u2663', '\u2666', '\u2660', '\u2665'][choice.suit]
        if (choice.alone) {
            width = 180
            text += ' alone'
        }
    }

    return {
        width: width,
        height: height,
        color: color,
        text: text,
    }
}

function drawTrumpChoice(ctx, choice, x, y, t, just) {
    t = t === undefined ? 1 : t
    just = just === undefined ? 0 : just
    let format = formatTrumpChoice(choice)
    let height = format.height * (1 - t * 0.4)
    let width = Math.max(format.width * (1 - t * 0.4), height)

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    drawBox(ctx, x - (just + 1) * width / 2, y - height / 2, width, height, height / 2, undefined)
    if (t == 0) {
        drawText(ctx, format.text, x - just * width / 2, y + 1, 1, 1, font.large, format.color)
    } else {
        drawText(ctx, format.text, x - just * width / 2, y, 1, 1, font.medium, format.color)
    }
}

function drawEuchreScore(ctx, x, y, score, suits, img) {
    let u = img.height
    let x0 = x
    let y0 = y
    switch (score) {
        case undefined:
        case 0:
            drawCard(ctx, new Card(), x0, y0, 1, img, false, -1, undefined)
            break
        case 1:
            x0 = x + 0.1 * u
            y0 = y + 0.1 * u
            drawCard(ctx, new Card(6, 2 - suits), x0, y0, 1, img, false, -1, undefined)
            drawCard(ctx, new Card(), x0 - 0.1 * u, y0 - 0.135 * u, 1, img, false, -1, undefined, Math.PI * 0.25)
            break
        case 2:
            y0 = y + 0.1 * u
            drawCard(ctx, new Card(6, 2 - suits), x0, y0, 1, img, false, -1, undefined)
            drawCard(ctx, new Card(), x0, y0 - 0.25 * u, 1, img, false, -1, undefined, Math.PI * 0.5)
            break
        case 3:
            x0 = x + 0.2 * u
            drawCard(ctx, new Card(6, 2 - suits), x0, y0, 1, img, false, -1, undefined)
            drawCard(ctx, new Card(), x0 - 0.4 * u, y0, 1, img, false, -1, undefined)
            break
        case 4:
            drawCard(ctx, new Card(4, 1 + suits), x0, y0, 1, img, false, -1, undefined)
            break
        case 5:
            x0 = x + 0.1 * u
            y0 = y + 0.1 * u
            drawCard(ctx, new Card(6, 2 - suits), x0, y0, 1, img, false, -1, undefined)
            drawCard(ctx, new Card(4, 1 + suits), x0 - 0.1 * u, y0 - 0.135 * u, 1, img, false, -1, undefined, Math.PI * 0.25)
            break
        case 6:
            drawCard(ctx, new Card(6, 2 - suits), x0, y0, 1, img, false, -1, undefined)
            break
        case 7:
            x0 = x + 0.2 * u
            drawCard(ctx, new Card(6, 2 - suits), x0, y0, 1, img, false, -1, undefined)
            drawCard(ctx, new Card(4, 1 + suits), x0 - 0.4 * u, y0, 1, img, false, -1, undefined)
            break
        case 8:
            y0 = y + 0.25 * u
            drawCard(ctx, new Card(6, 2 - suits), x0, y0, 1, img, false, -1, undefined)
            drawCard(ctx, new Card(4, 1 + suits), x0, y0 - 0.5 * u, 1, img, false, -1, undefined, Math.PI * 0.5)
            break
        case 9:
            x0 = x + 0.2 * u
            y0 = y + 0.3 * u
            drawCard(ctx, new Card(6, 2 - suits), x0, y0, 1, img, false, -1, undefined)
            drawCard(ctx, new Card(4, 1 + suits), x0 - 0.35 * u, y0 - 0.5 * u, 1, img, false, -1, undefined, Math.PI * 0.25)
            break
        case 10:
        case 11:
        case 12:
        case 13:
            x0 = x + 0.35 * u
            drawCard(ctx, new Card(6, 2 - suits), x0, y0, 1, img, false, -1, undefined)
            drawCard(ctx, new Card(4, 1 + suits), x0 - 0.75 * u, y0, 1, img, false, -1, undefined)
            break
        default:
            break
    }
}

class EuchreCanvas extends CanvasBase {
    constructor(client) {
        super(client)
    }

    initialize() {
        if (this.initialized) {
            return
        }
        super.initialize()

        let thisCanvas = this

        // listeners
        this.robotsSpinner = document.getElementById("igRobots")
        this.robotsSpinner.addEventListener('change', () => { this.client.state.sendOptionsUpdate({ robots: this.robotsSpinner.value }) })

        igLobby.addEventListener('click', () => this.client.changeState('EUCHRE_PREGAME'))

        // filled out statically
        class EuchreScoreSheet extends PanelInteractable {
            constructor() {
                super(
                    document.getElementById('igScoreSheetEuchreContainer'),
                    document.getElementById('igScoreSheetEuchreCanvas'),
                    false
                )
                this.scoreMargin = 10
                this.margin = 30
            }

            paint() {
                super.paint()
                if (!this.isShown()) {
                    return
                }

                this.clear();
                this.fillContainer();

                let img = this.height() / 2 > this.margin + 1.707 * thisCanvas.client.vars.deckImg.height ? thisCanvas.client.vars.deckImg : thisCanvas.client.vars.deckImgSmall
                let x = this.width() / 2
                let y1 = 3 * this.margin + img.height / 2
                let y2 = this.height() / 2 + 3 * this.margin + img.height / 2
                let players = thisCanvas.client.state.baseState.serverData.players
                let myPlayer = thisCanvas.client.state.baseState.myPlayer
                let scores = [players[myPlayer.index].score, players[(myPlayer.index + 1) % players.length].score]

                drawText(this.ctx, 'Us', x, this.margin, 1, 1, font.bold, 'black')
                drawEuchreScore(this.ctx, x, y1, scores[0], 0, img)

                drawText(this.ctx, 'Them', x, this.height() / 2 + this.margin, 1, 1, font.bold, 'black')
                drawEuchreScore(this.ctx, x, y2, scores[1], 1, img)
            }
        }
        this.scoreSheet = new EuchreScoreSheet()
        this.scoreSheet.x = () => this.client.cachedWidth - (this.client.state.baseState.getScoreWidth() - this.scoreSheet.scoreMargin)
        this.scoreSheet.y = () => this.scoreSheet.scoreMargin
        this.scoreSheet.width = () => this.client.state.baseState.getScoreWidth() - 2 * this.scoreSheet.scoreMargin
        this.scoreSheet.height = () => this.chatArea.y() - 2 * this.scoreSheet.scoreMargin
        this.scoreSheet.container = () => this.client.state.scoreSheetContainer()
        this.scoreSheet.isShown = () => this.client.state.paintScoreSheet()

        class EuchreDespacito extends WrappedDOMElement {
            constructor() {
                super(document.createElement('div'))
            }

            start(startTime, endTime) {
                this.yt = document.createElement('iframe')
                this.yt.src = "https://www.youtube.com/embed/7YJCp6J9H8E?start=" + startTime + "&end=" + endTime + "&autoplay=1&controls=0&disablekb=1&modestbranding=1"
                this.yt.allow = "autoplay; encrypted-media;"
                this.yt.setAttribute("allowfullscreen", "")
                this.yt.style.cssText = "position:absolute; width:640px; height:480px;"
                this.yt.style['pointer-events'] = "none"
                this.element.appendChild(this.yt)

                this.topMask = document.createElement('div')
                this.topMask.style.cssText = "position:absolute; width:640px; height:60px;"
                this.topMask.style.backgroundColor = 'black'
                this.element.appendChild(this.topMask)

                this.bottomMask = document.createElement('div')
                this.bottomMask.style.cssText = "position:absolute; top:420px; width:640px; height:60px;"
                this.bottomMask.style.backgroundColor = 'black'
                this.element.appendChild(this.bottomMask)
            }

            stop() {
                this.element.removeChild(this.yt)
            }
        }
        this.despacito = new EuchreDespacito()
        this.despacito.width = () => 640
        this.despacito.height = () => 480
        this.despacito.x = () => (this.client.cachedWidth - this.client.state.baseState.getScoreWidth() - this.despacito.width()) / 2
        this.despacito.y = () => (this.client.cachedHeight - this.despacito.height() ) / 2
        this.despacito.isShown = () => this.client.state.paintDespacito()
        this.despacito.container = () => document.getElementById('inGameDiv')

        // filled out dynamically
        this.trumpButtons = [];

        this.interactables = this.interactables.concat([
            [this.scoreSheet],
            this.trumpButtons,
            [this.despacito]
        ])
    }

    customPaintFirst() {
        this.paintUpCard()
        this.paintTrumpChoice()
        super.customPaintFirst()
        this.updateTrumpInteractables()
    }

    updateHostOptions() {
        if (!this.client.state.baseState.myPlayer) {
            return
        }
        if (!this.client.state.baseState.myPlayer.host) {
            this.robotsSpinner.disabled = true
            disableButton(this.igStart)
        } else {
            this.robotsSpinner.disabled = false
            enableButton(this.igStart)
        }
    }

    paintUpCard() {
        if (!this.client.state.paintUpCard()) {
            return;
        }

        let serverData = this.client.state.baseState.serverData
        let dealer = Math.min(serverData.roundNumber, serverData.rounds.length - 1)
        let player = serverData.players[serverData.rounds[dealer].dealer]
        let x0 = player.getUpCardX()
        let y0 = player.getUpCardY()

        drawCard(this.client.ctx, new Card(), x0 - 6, y0 - 6, smallCardScale, this.client.vars.deckImgSmall, false, -1, undefined);
        drawCard(this.client.ctx, new Card(), x0 - 4, y0 - 4, smallCardScale, this.client.vars.deckImgSmall, false, -1, undefined);
        drawCard(this.client.ctx, new Card(), x0 - 2, y0 - 2, smallCardScale, this.client.vars.deckImgSmall, false, -1, undefined);
        if (!this.client.state.upCardIsDrawn()) {
            let card
            if (this.client.state.upCardIsDown()) {
                card = new Card()
            } else {
                card = serverData.upCard
            }

            let x1 = player.getX() - (player.getJust() - 1) * this.client.vars.maxWid / 2
            let y1 = player.getY() - 40
            let t = this.client.state.baseState.pickUpTimer
            let x = x0 * (1 - t) + x1 * t
            let y = y0 * (1 - t) + y1 * t

            drawCard(this.client.ctx, card, x, y, smallCardScale, this.client.vars.deckImgSmall, false, -1, undefined);
        }
    }

    paintTrumpChoice() {
        if (!this.client.state.paintUpCard()) {
            return;
        }

        let serverData = this.client.state.baseState.serverData
        for (let player of serverData.players) {
            if (player.bidded) {
                let t = this.client.state.baseState.trumpTimer
                if (t > 0 && player.trumpChoice.pass) {
                    continue
                }

                let iRelToMe = player.index - this.client.state.baseState.myPlayer.index
                let startX = (this.client.cachedWidth - this.client.state.baseState.getScoreWidth()) / 2 - 100 * Math.sin(2 * Math.PI * iRelToMe / serverData.players.length);
                let startY = this.client.cachedHeight / 2 - 50 + 100 * Math.cos(2 * Math.PI * iRelToMe / serverData.players.length);
                let endX = player.getTrumpX()
                let endY = player.getTrumpY()
                let bidX = startX * (1 - t) + endX * t;
                let bidY = startY * (1 - t) + endY * t;

                drawTrumpChoice(this.client.ctx, player.trumpChoice, bidX, bidY, t, (player.getJust() - 1) * t)
            }
        }
    }

    updateTrumpInteractables() {
        let paintTrumpInteractables = this.client.state.paintTrumpInteractables()
        if (this.trumpButtons.length == 0 && paintTrumpInteractables) {
            this.makeTrumpInteractables()
        } else if (this.trumpButtons.length > 0 && !paintTrumpInteractables) {
            this.removeTrumpInteractables()
        }
    }

    makeTrumpInteractables() {
        this.trumpButtons.length = 0
        let trumpChoices = this.client.state.getTrumpChoices()
        let totalWidth = -10
        for (let choice of trumpChoices) {
            let format = formatTrumpChoice(choice)

            let button = document.createElement('button');
            button.innerHTML = `<p style="color:${adjustedStyle(format.color)};">${format.text}</p>`
            button.classList.add(
                'bg-white', 'rounded-lg', 'border', 'border-black', 'w-5', 'h-5',
                'font-bold', 'text-2xl', 'select-none', 'hover:bg-gray-300'
            );
            button.addEventListener('click', () => {
                this.client.state.makeTrumpChoice(choice)
                this.removeTrumpInteractables()
            })

            let height = format.height * 0.666
            let width = Math.max(format.width * 0.6, height)
            totalWidth += width + 10

            let wrappedButton = new WrappedDOMElement(button)
            wrappedButton.y = () => this.client.cachedHeight - 210 - 15
            wrappedButton.width = () => width
            wrappedButton.height = () => height
            wrappedButton.container = () => document.getElementById('inGameDiv')
            this.trumpButtons.push(wrappedButton)
        }
        let offset = -totalWidth / 2
        for (let button of this.trumpButtons) {
            let copy = offset
            button.x = () => (this.client.cachedWidth - this.client.state.baseState.getScoreWidth()) / 2 + copy
            offset += button.width() + 10
        }
    }

    removeTrumpInteractables() {
        for (let button of this.trumpButtons) {
            button.dispose()
        }
        this.trumpButtons.length = 0
    }

    createPostGamePage() {
        return new EuchrePostGamePage(this)
    }

    loadPostGame(data) {
        this.postGamePage.clearData()

        data.trumps = data.trumps.map(c => new Card(c.num, c.suit))
        for (const player of data.players) {
            //player.bidQs = player.bidQs.map(r => r.map(pr => 100 * pr))
            player.hands = player.hands.map(h => h.map(c => new Card(c.num, c.suit)))
            player.plays = player.plays.map(h => h.map(c => new Card(c.num, c.suit)))
            //player.makingProbs = player.makingProbs.map(r => r.map(t => t.map(pair => [new Card(pair[0].num, pair[0].suit), pair[1]])))
        }

        this.pgPlayers = data.players
        this.pgTeams = data.teams
        this.pgRounds = data.rounds
        this.pgOptions = data.options

        this.postGamePage.setData(data)
    }
}

class EuchrePostGamePage extends PostGamePage {
    constructor(canvas) {
        super(canvas)
        this.addTab(EuchrePostGamePlaysTab, document.getElementById("igPlays"))
    }
}

class EuchrePostGamePlaysTab extends PostGameTab {
    constructor(page, index) {
        super(page, index);

        this.elements = [
            document.getElementById("igPlaysTabContainer")
        ];

        this.headerHeight = 35;
        this.margin = 4;
        this.columnXs = [
            3 / 16, 11 / 32, 1 / 2, 23 / 32, 15 / 16
        ];

        let parent = this;
        class PlaysPanel extends PanelInteractable {
            constructor() {
                super(
                    document.getElementById("igPlaysContainer"),
                    document.getElementById("igPlaysCanvas"),
                    true
                );
            }

            wheel(y) {
                parent.deltaRound(Math.sign(y));
            }

            paint() {
                super.paint();
                parent.paintHeader(this.ctx, this.width());
                parent.paintBody(this.ctx, this.width(), this.height());
            }
        }
        this.panel = new PlaysPanel();
        this.interactables = [this.panel];
    }

    addData(data) {
        this.options = data.options;
        this.numRounds = data.players[0].hands.length;
        this.numTricks = new Array(this.numRounds);

        this.rounds = data.rounds.map(r => r.handSize);
        this.dealers = data.rounds.map(r => r.dealer);
        this.claims = data.claims;

        let div = document.getElementById('igPlaysRoundsButtonContainer');
        while (div.firstChild) {
            div.removeChild(div.firstChild);
        }
        this.buttons0 = new Array(this.numRounds);
        for (let i = 0; i < this.numRounds; i++) {
            let button = document.createElement('button');
            button.classList.add(
                'bg-white', 'rounded-lg', 'border', 'border-black', 'w-5', 'h-5',
                'font-bold', 'text-sm', 'select-none', 'hover:bg-gray-300'
            );
            button.innerHTML = this.rounds[i];
            button.addEventListener('click', () => {
                this.selectRound(i);
                this.selectTrick(0);
            });
            div.appendChild(button);
            this.buttons0[i] = button;

            let min = Math.min(...data.players.map(p => p.plays[i].length));
            let max = Math.max(...data.players.map(p => p.plays[i].length));

            this.numTricks[i] = max;
            if (max == 0 || (min == max && max < this.rounds[i] && this.claims[i] != -1)) {
                this.numTricks[i]++;
            }
        }

        this.selected0 = undefined;
        this.selected1 = undefined;
        this.selectRound(0);
        this.selectTrick(0);

        this.players = data.players;
        this.trumps = data.trumps;
        this.leaders = data.leaders;
        this.winners = data.winners;

        // should I put this mess server-side?
        this.hands = new Array(this.players.length);
        this.playIndices = new Array(this.players.length);
        this.takens = new Array(this.players.length);
        for (let i = 0; i < this.players.length; i++) {
            let player = this.players[i];
            this.hands[i] = new Array(this.numRounds);
            this.playIndices[i] = new Array(this.numRounds);
            this.takens[i] = new Array(this.numRounds);
            for (let j = 0; j < this.numRounds; j++) {
                this.hands[i][j] = new Array(this.numTricks[j]);
                this.playIndices[i][j] = new Array(this.numTricks[j]);
                this.takens[i][j] = new Array(this.numTricks[j]);

                let hand = player.hands[j];
                let taken = 0
                for (let k = 0; k < this.numTricks[j]; k++) {
                    this.hands[i][j][k] = hand;
                    hand = hand.map(c => c);
                    if (player.plays[j][k] !== undefined) {
                        for (let l = 0; l < hand.length; l++) {
                            if (hand[l].matches(player.plays[j][k])) {
                                this.playIndices[i][j][k] = l;
                                hand.splice(l, 1);
                                break;
                            }
                        }
                    } else if (k >= this.leaders[j].length) {
                        if (k == 0) {
                            this.leaders[j][k] = (this.dealers[j] + 1) % this.players.length;
                        } else {
                            this.leaders[j][k] = this.winners[j][k - 1];
                        }
                    }
                    if (i == this.winners[j][k]) {
                        taken++
                    }
                    this.takens[i][j][k] = taken;
                }
            }
        }
    }

    wheel(y) {
        this.deltaRound(Math.sign(y));
    }

    deltaRound(e) {
        if (e == -1) {
            if (this.selected1 == 0 && this.selected0 > 0) {
                this.selectRound(this.selected0 - 1);
                this.selectTrick(this.buttons1.length - 1);
            } else if (this.selected1 > 0) {
                this.selectTrick(this.selected1 - 1);
            }
        } else {
            if (this.selected1 == this.buttons1.length - 1 && this.selected0 < this.buttons0.length - 1) {
                this.selectRound(this.selected0 + 1);
                this.selectTrick(0);
            } else if (this.selected1 < this.buttons1.length - 1) {
                this.selectTrick(this.selected1 + 1);
            }
        }
    }

    selectRound(i) {
        if (i == this.selected0) {
            return;
        }

        if (this.selected0 !== undefined) {
            toggleButton(this.buttons0[this.selected0]);
        }
        this.selected0 = i;
        toggleButton(this.buttons0[this.selected0]);

        let div = document.getElementById('igPlaysTricksButtonContainer');
        while (div.firstChild) {
            div.removeChild(div.firstChild);
        }
        this.buttons1 = new Array(this.numTricks[i]);
        for (let j = 1; j <= this.numTricks[i]; j++) {
            let button = document.createElement('button');
            button.classList.add(
                'bg-white', 'rounded-lg', 'border', 'border-black', 'w-5', 'h-5',
                'font-bold', 'text-sm', 'select-none', 'hover:bg-gray-300'
            );
            button.innerHTML = j;
            button.addEventListener('click', () => {
                this.selectTrick(j - 1);
            });
            div.appendChild(button);
            this.buttons1[j - 1] = button;
        }
        this.selected1 = undefined;
    }

    selectTrick(j) {
        if (j == this.selected1) {
            return;
        }

        if (this.selected1 !== undefined) {
            toggleButton(this.buttons1[this.selected1]);
        }
        this.selected1 = j;
        toggleButton(this.buttons1[this.selected1]);
    }

    paintHeader(ctx, width) {
        drawText(ctx, 'up card', width * this.columnXs[0], this.headerHeight / 2, 1, 1, font.small, 'black');
        drawText(ctx, 'trump', width * this.columnXs[1], this.headerHeight / 2, 1, 1, font.small, 'black');
        drawText(ctx, 'led/won', width * this.columnXs[2], this.headerHeight / 2, 1, 1, font.small, 'black');
        drawText(ctx, 'hand', width * this.columnXs[3], this.headerHeight / 2, 1, 1, font.small, 'black');
        drawText(ctx, 'tricks taken', width * this.columnXs[4], this.headerHeight / 2, 1, 1, font.small, 'black');
    }

    paintBody(ctx, width, height) {
        let h = (height - this.headerHeight - 2) / this.players.length;
        for (let i = 0; i <= this.players.length; i++) {
            ctx.strokeStyle = '#C0C0C0';
            drawLine(ctx, this.margin, this.headerHeight + i * h, width - this.margin, this.headerHeight + i * h);

            if (i == this.players.length) {
                break;
            }

            let player = this.players[i];
            let h0 = this.headerHeight + player.index * h + h / 2;
            let deckImgSmall = this.page.canvas.client.vars.deckImgSmall

            // name
            drawText(ctx, player.name, 2 * this.margin, h0, 0, 1, font.basic, this.options.teams ? colors[player.team] : 'black');

            // up card
            if (player.index == this.dealers[this.selected0]) {
                drawCard(ctx, new Card(), width * this.columnXs[0] - 4, h0 + 30 - 4, smallCardScale, deckImgSmall, false, h0 + h / 2, undefined);
                drawCard(ctx, new Card(), width * this.columnXs[0] - 2, h0 + 30 - 2, smallCardScale, deckImgSmall, false, h0 + h / 2, undefined);
                drawCard(ctx, this.trumps[this.selected0], width * this.columnXs[0], h0 + 30, smallCardScale, deckImgSmall, false, h0 + h / 2, undefined);
            }

            // trump
            let choices = player.trumpChoices[this.selected0]
            for (let i = 0; i < choices.length; i++) {
                drawTrumpChoice(ctx, choices[i], width * this.columnXs[1] - 2 + 4 * i, h0, 1, 1 - 2 * i)
            }

            // leader/winner/claim
            let leader = player.index == this.leaders[this.selected0][this.selected1];
            let winner = player.index == this.winners[this.selected0][this.selected1];
            let claimer = player.index == this.claims[this.selected0] && this.selected1 == this.numTricks[this.selected0] - 1;
            if (leader) {
                ctx.fillStyle = 'rgb(200, 200, 200)';
                drawOval(ctx, width * this.columnXs[2] - 8 - (winner ? 10 : 0) - (claimer ? 30 : 0), h0 - 8, 16, 16);
                drawText(ctx, '>', width * this.columnXs[2] - (winner ? 10 : 0) - (claimer ? 30 : 0), h0, 1, 1, font.basic, 'black');
            }
            if (winner) {
                ctx.fillStyle = 'rgb(175, 175, 0)';
                drawOval(ctx, width * this.columnXs[2] - 8 + (leader ? 10 : 0), h0 - 8, 16, 16);
                drawText(ctx, 'w', width * this.columnXs[2] + (leader ? 10 : 0), h0, 1, 1, font.basic, 'black');
            }
            if (claimer) {
                ctx.fillStyle = 'rgb(225, 175, 225)';
                drawOval(ctx, width * this.columnXs[2] - 25 + (leader ? 10 : 0), h0 - 12, 50, 24);
                drawText(ctx, 'claim', width * this.columnXs[2] + (leader ? 10 : 0), h0, 1, 1, font.basic, 'black');
            }

            // hand
            let hand = this.hands[i][this.selected0][this.selected1];
            for (let j = 0; j < hand.length; j++) {
                drawCard(ctx,
                    hand[j],
                    width * this.columnXs[3] + 30 * (j - (hand.length - 1) / 2),
                    h0 + h / 2 + 15 - (j == this.playIndices[i][this.selected0][this.selected1] ? 15 : 0),
                    smallCardScale, deckImgSmall, false, h0 + h / 2, undefined);
            }
            for (let j = 0; j < hand.length; j++) {
                let x = width * this.columnXs[3] + 30 * (j - (hand.length - 1) / 2);
                //let prob = this.selected1 < player.makingProbs[this.selected0].length ? player.makingProbs[this.selected0][this.selected1][j][1] : -1;
                let prob = -1
                if (prob != -1) {
                    ctx.fillStyle = 'white';
                    drawOval(ctx, x - 12, h0 - h / 2 + 15 - 8, 24, 16, true);
                    ctx.strokeStyle = 'black';
                    drawOval(ctx, x - 12, h0 - h / 2 + 15 - 8, 24, 16, false);
                }
                drawText(ctx,
                    prob == -1 ? '' : (100 * prob).toFixed(0) + '%',
                    x, h0 - h / 2 + 15,
                    1, 1, font.small, `rgb(${255 * (1 - prob)}, ${0.75 * 255 * prob}, 0)`
                );
            }

            // wants
            let taken = this.takens[i][this.selected0][this.selected1] !== undefined ? this.takens[i][this.selected0][this.selected1] : '--';
            drawText(ctx, taken, width * this.columnXs[4], h0, 1, 1, font.basic, 'black');
        }
    }

    paint() {
        this.panel.paint();
    }
}