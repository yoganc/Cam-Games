import { Card } from '../basics.js'

import {
    font, colors, smallCardScale, getStringDimensions, drawText, drawBox, drawOval, createDeckImg, drawCard, drawLine, enableButton, disableButton, toggleButton
} from '../graphics_tools.js'

import {
    CanvasInteractable, WrappedDOMElement, PanelInteractable, CanvasButton, PlayerNamePlate, CanvasCard
} from '../interactable.js'

import { TimerEntry, OhcCanvas } from '../canvas.js'

import { ScoreSheet } from '../scoresheet.js'

import { PostGamePage, PostGameTab, PostGameSummaryTab, PostGameBidsTab } from '../postgame.js'

import { ClientStateGameBase, createClientStatePreGame, createClientStatePlaying, createClientStatePostGame, CanvasBase } from './base.js'

// states

export class ClientStateOhHell extends ClientStateGameBase {
    constructor(key, client, div) {
        super(key, 'OH_HELL_BASE', client, div, key == 'OH_HELL_BASE' ? OhHellCanvas : undefined)
    }

    initialize() {
        super.initialize()
        this.showSpreadsheet = false
        this.showOneCard = false
        this.decision = undefined
        this.decisionResponded = false

        this.bidTimer = 1
    }

    toggleShowSpreadsheet() {
        this.baseState.showSpreadsheet = !this.baseState.showSpreadsheet
    }

    updateServerData_options(type, diff) {
        let options = this.baseState.serverData.options
        if (options.robots !== undefined) {
            this.canvas.robotsSpinner.value = options.robots
            this.canvas.trainedRobotsSpinner.max = options.robots
        }
        if (options.trainedRobots !== undefined) {
            this.canvas.trainedRobotsSpinner.value = options.trainedRobots
        }
        this.canvas.renderTrainedModels()
        if (options.D !== undefined) {
            this.canvas.doubleDeckCheckBox.checked = options.D == 2
        }
        if (options.teams !== undefined) {
            this.canvas.teamsCheckBox.checked = options.teams
            document.getElementById('teamsDiv').style.display = options.teams ? 'inline' : 'none'
        }
    }

    updateServerData_players(type, diff) {
        super.updateServerData_players(type, diff)
        if (this.canvas.renderTrainedModels) this.canvas.renderTrainedModels()

        let myIndex = this.baseState.myPlayer.index
        if (type == 'update' && diff.players[myIndex] && diff.players[myIndex].hand && diff.players[myIndex].hand.length > 0) {
            let round = this.baseState.serverData.rounds[this.baseState.serverData.roundNumber]
            this.baseState.showOneCard = round.handSize > 1 || myIndex != round.dealer || this.baseState.myPlayer.kibitzer
        }
    }

    undoBid() {
        this.client.emit('undobid')
    }

    paintTrump() { return false }
    paintShowSpreadsheet() { return false }
    paintSpreadsheet() { return this.paintShowSpreadsheet() && this.baseState.showSpreadsheet }
    bidChipColor(player) { return 'rgba(255, 255, 255, 0.7)' }
    paintBidInteractables() { return false }
    hideCard(card) { return !this.baseState.showOneCard }
    paintUndoBid() { return false }

    getTeamBid(team) { return team.members.reduce((a, i) => a + this.baseState.serverData.players[i].bid, 0) }
    getTeamTaken(team) { return team.members.reduce((a, i) => a + this.baseState.serverData.players[i].taken, 0) }
    getTeamScore(team) {
        if (team.members.length == 0) {
            return undefined
        }
        return this.baseState.serverData.players[team.members[0]].score
    }

    showroundmessage() {
        if (this.baseState.myPlayer.kibitzer) {
            return
        }

        let te = new TimerEntry(this.client.vars.messageTime)
        te.onFirstAction = () => {
            let myPlayer = this.baseState.myPlayer
            if (myPlayer.kibitzer) {
                return
            }

            let teams = this.baseState.serverData.options.teams
            let pronoun = teams ? 'Your team' : 'You';

            let bid = teams ? this.getTeamBid(this.baseState.serverData.teams[myPlayer.team]) : myPlayer.bid
            let taken = teams ? this.getTeamTaken(this.baseState.serverData.teams[myPlayer.team]) : myPlayer.taken

            let text = ''
            if (bid == taken) {
                text = pronoun + ' made it!'
            } else {
                text = pronoun + ' went down by ' + Math.abs(bid - taken) + '.'
            }
            this.baseState.message = text
        }
        te.onLastAction = () => {
            this.baseState.message = ''
        }
        this.canvas.pushTimerEntry(te)
    }

    checkIfShouldBidPreselected() { return false }
}

export class ClientStateOhHellPreGame extends createClientStatePreGame(ClientStateOhHell) {
    constructor(key, client) {
        super(key, client)
    }

    enter(data) {
        super.enter(data)
        document.getElementById("oregonOptionsRow").style.display = 'none';
    }
}

export class ClientStateOhHellBidding extends ClientStateOhHell {
    constructor(key, client) {
        super(key, client, document.getElementById('inGameDiv'))
    }

    initialize() {
        this.baseState = this.client.stateCache[this.baseKey]
        this.cannotBid = -1
    }

    animateBids() {
        let animateTe = new TimerEntry(this.client.vars.animationTime);
        animateTe.onAction = () => {
            this.baseState.bidTimer = Math.min(animateTe.elapsedTime / this.client.vars.animationTime, 1)
        }
        this.canvas.pushTimerEntry(animateTe, true);

        let stayTe = new TimerEntry(this.client.vars.bidStayTime);
        this.canvas.pushTimerEntry(stayTe, true);

        let bufferTe = new TimerEntry(0);
        this.canvas.pushTimerEntry(bufferTe, true);

        this.pushBasicTimer(() => { }, this.client.vars.bidStayTime, true)
    }

    updateServerData_state(type, diff) {
        super.updateServerData_state(type, diff)
        if (diff.state == 'OH_HELL_PLAYING') {
            this.animateBids()
        }
    }

    updateServerDataArgs_cannotBid(type, args) {
        this.cannotBid = args
    }

    makeBid(bid) {
        this.client.emit('bid', { bid: bid })
    }

    enter(data) {
        super.enter(data)
        this.baseState.bidTimer = 0
    }

    adjustDivSizes() { this.canvas.fixScoreWidth() }
    paintHotdog() { return this.baseState.serverData.roundNumber < this.baseState.serverData.rounds.length }
    paintTeamInfo() {
        return false // deprecated
        //let data = this.baseState.serverData
        //return data.roundNumber < data.rounds.length && !this.baseState.myPlayer.kibitzer && data.options.teams
    }
    paintTrump() { return this.baseState.serverData.trump !== undefined }
    paintPlayers() { return true }
    paintTaken() { return true }
    paintUndoBid() { return !this.baseState.myPlayer.kibitzer && this.baseState.myPlayer.index == this.baseState.serverData.canUndo }
    paintShowSpreadsheet() { return this.baseState.serverData.spreadsheetSequence !== undefined }
    paintCornerButtons() { return true }
    paintPreselected() { return true }
    paintNamePlates() { return true }
    highlightPlayer(player) { return player.index == this.baseState.serverData.turn }
    enablePoking(player) { return this.highlightPlayer(player) }
    paintBidAndDealerChips() { return true }
    dotsBidTaken(player) { return undefined }
    paintScoreSheet() { return true }
    cardEnabled(card) { return this.baseState.myPlayer.bidded || !this.baseState.preselected.empty() }
    paintShowCardButton() { return this.canvas.cardInteractables && this.canvas.cardInteractables.length > 0 && this.canvas.cardInteractables[0].hidden() }
    paintBidInteractables() { return !this.baseState.myPlayer.kibitzer && !this.baseState.myPlayer.bidded }
    paintHandInteractables() { return true }
    checkIfShouldPlayPreselected() { return false }

    checkIfShouldBidPreselected() {
        return this.isItMyTurn() && this.cannotBid !== undefined
    }
}

export class ClientStateOhHellPlaying extends createClientStatePlaying(ClientStateOhHell) {
    constructor(key, client) {
        super(key, client)
    }

    paintHotdog() { return this.baseState.serverData.roundNumber < this.baseState.serverData.rounds.length }
    paintTeamInfo() {
        return false // deprecated
        //let data = this.baseState.serverData
        //return data.roundNumber < data.rounds.length && !this.baseState.myPlayer.kibitzer && data.options.teams
    }
    paintTrump() { return this.baseState.serverData.trump !== undefined }
    paintUndoBid() { return !this.baseState.myPlayer.kibitzer && this.baseState.myPlayer.index == this.baseState.serverData.canUndo }
    paintShowSpreadsheet() { return this.baseState.serverData.spreadsheetSequence !== undefined }
    paintBidAndDealerChips() { return true }
    bidChipColor(player) {
        if (this.baseState.bidTimer < 1) {
            return 'rgba(255, 255, 255, 0.7)'
        }

        let want = player.bid - player.taken
        let h = player.hand.length + (player.trick.num == 0 ? 0 : 1)
        if (this.baseState.serverData.options.teams) {
            let team = this.baseState.serverData.teams[player.team]
            want = this.getTeamBid(team) - this.getTeamTaken(team)
        }

        if (want > 0 && want <= h) {
            return 'rgba(175, 175, 175, 0.7)'
        } else if (want == 0) {
            return 'rgb(125, 255, 125)'
        } else {
            return 'rgb(255, 175, 175)'
        }
    }
    dotsBidTaken(player) {
        if (this.baseState.serverData.options.teams) {
            let team = this.baseState.serverData.teams[player.team]
            return [this.getTeamBid(team), this.getTeamTaken(team)]
        }
        return [player.bid, player.taken]
    }
}

export class ClientStateOhHellPostGame extends createClientStatePostGame(ClientStateOhHell) {
    constructor(key, client) {
        super(key, client)
    }
}

// canvas

class OhHellCanvas extends CanvasBase {
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

        this.trainedRobotsSpinner = document.getElementById("igTrainedRobots")
        this.trainedRobotsSpinner.addEventListener('change', () => { this.client.state.sendOptionsUpdate({ trainedRobots: this.trainedRobotsSpinner.value }) })

        this.trainedModelsDiv = document.getElementById("igTrainedModels")

        this.doubleDeckCheckBox = document.getElementById("igDoubleDeck")
        this.doubleDeckCheckBox.addEventListener('change', () => { this.client.state.sendOptionsUpdate({ D: this.doubleDeckCheckBox.checked ? 2 : 1 }) })

        this.teamsCheckBox = document.getElementById("igTeams")
        this.teamsCheckBox.addEventListener('change', () => { this.client.state.sendOptionsUpdate({ teams: this.teamsCheckBox.checked }) })

        igLobby.addEventListener('click', () => this.client.changeState('OH_HELL_PREGAME'))

        let thisCanvas = this

        // filled out statically
        class OhHellScoreSheet extends ScoreSheet {
            constructor(prefix, canvas) { super(prefix, canvas) }

            paintRoundLabels(ctx) {
                // dealers and hand sizes
                for (let i = 0; i < this.rounds.length; i++) {
                    let round = this.rounds[i];
                    drawText(ctx,
                        round.handSize,
                        this.margin + this.dealerHWidth / 2,
                        this.scoreVSpacing * (i + 0.5),
                        1, 1,
                        font.basic, 'black'
                    );
                    drawText(ctx,
                        Array.from(this.playersUnsorted[round.dealer].name)[0],
                        2 * this.margin + 1.5 * this.dealerHWidth,
                        this.scoreVSpacing * (i + 0.5),
                        1, 1,
                        font.basic, 'black'
                    );
                }
            }

            paintScroll(ctx) {
                let wid = (this.width() - 4 * this.margin - 2 * this.dealerHWidth) / this.players.length;
                let height = this.scrollCanvasHeight();

                let currentX = 3 * this.margin + 2 * this.dealerHWidth;

                let colCount = this.options.teams ? this.teams.length : this.players.length;
                for (let i = 0; i < colCount; i++) {
                    let members = this.options.teams ? this.teams[i].members.map(j => this.players[j]) : [this.players[i]];
                    let scoresList = members[0].scores;
                    if (!scoresList) {
                        scoresList = []
                    }
                    let fullWid = wid * members.length;

                    if (i > 0) {
                        drawLine(ctx, currentX, 0, currentX, height);
                    }

                    for (let j = 0; j < this.rounds.length; j++) {
                        let score = j < scoresList.length ? scoresList[j] : '';

                        let k = members.length;
                        let fnt = font.basic;
                        let b = 0;

                        // bid chips
                        b = (fnt == font.basic ? 13 : 9) + 3;
                        let chipStart = j < scoresList.length ? 0 : this.margin + b - wid;
                        let chipSpacing = j < scoresList.length ? this.margin + b : wid;
                        for (const p of members) {
                            if (p.bids && j < p.bids.length) {
                                if (p.takens === undefined || j >= p.takens.length) {
                                    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)'
                                } else if (members.reduce((a, m) => a + m.bids[j] - m.takens[j], 0) == 0) {
                                    ctx.fillStyle = 'rgb(125, 255, 125, 0.5)'
                                } else {
                                    ctx.fillStyle = 'rgb(255, 175, 175, 0.5)'
                                }

                                drawOval(ctx,
                                    currentX + 1 + fullWid - chipSpacing * k - chipStart,
                                    this.scoreVSpacing * (j + 0.5) - b / 2,
                                    b, b
                                );
                                drawText(ctx,
                                    p.bids[j],
                                    currentX + 1 + fullWid - chipSpacing * k - chipStart + b / 2,
                                    this.scoreVSpacing * (j + 0.5),
                                    1, 1,
                                    fnt, 'black'
                                );
                            }
                            k--;
                        }

                        // scores
                        k = members.length;
                        drawText(ctx,
                            score,
                            currentX + 1 + fullWid / 2 - this.margin * k / 2 - b * k / 2,
                            this.scoreVSpacing * (j + 0.5),
                            1, 1,
                            fnt, 'black'
                        );
                    }

                    currentX += fullWid;
                }
            }
        }
        this.scoreSheet = new OhHellScoreSheet('ig', this);
        this.scoreSheet.x = () => this.client.cachedWidth - (this.client.state.baseState.getScoreWidth() - this.scoreSheet.scoreMargin)
        this.scoreSheet.y = () => this.scoreSheet.scoreMargin
        this.scoreSheet.width = () => this.client.state.baseState.getScoreWidth() - 2 * this.scoreSheet.scoreMargin
        this.scoreSheet.getPlayers = () => this.scoreSheetPlayers();
        this.scoreSheet.getTeams = () => this.scoreSheetTeams();
        this.scoreSheet.getRounds = () => this.scoreSheetRounds();
        this.scoreSheet.getOptions = () => this.scoreSheetOptions();
        this.scoreSheet.container = () => this.client.state.scoreSheetContainer()
        this.scoreSheet.isShown = () => this.client.state.paintScoreSheet()

        class TeamsPanel extends PanelInteractable {
            constructor() {
                super(
                    document.getElementById('igTeamsContainer'),
                    document.getElementById('igTeamsCanvas'),
                    true
                );

                let parent = this;

                class PlayerButton extends CanvasInteractable {
                    constructor(player) {
                        super();
                        this.player = player;
                        this.y0 = 1;
                    }

                    x() { return parent.x() + 5; }
                    y() { return parent.y() + this.y0 - 9; }
                    width() { return parent.width() - 10; }
                    height() { return 19; }

                    isEnabled() {
                        return thisCanvas.client.state.baseState.myPlayer && thisCanvas.client.state.baseState.myPlayer.host;
                    }

                    paint() {
                        let x = this.x() - parent.x();
                        let y = this.y() - parent.y();

                        if (this.isEnabled()) {
                            if (this.isMoused()) {
                                parent.ctx.fillStyle = '#C0C0C0';
                                drawBox(parent.ctx, x, y, this.width(), this.height(), 10, undefined, true);
                            }
                            if (parent.playerSelected === this.player) {
                                parent.ctx.fillStyle = '#C0C0C0';
                                drawBox(parent.ctx, x, y, this.width(), this.height(), 10, undefined, false);
                            }
                        }

                        drawText(parent.ctx, this.player.name, x + this.width() / 2, y + 10, 1, 1, font.basic, 'black');
                    }

                    click() {
                        if (parent.playerSelected === this.player) {
                            parent.playerSelected = undefined;
                        } else {
                            parent.playerSelected = this.player;
                        }
                    }
                }
                this.PlayerButton = PlayerButton;

                class TeamButton extends CanvasInteractable {
                    constructor(number) {
                        super();
                        this.number = number;
                        this.members = [];
                        this.y0 = 1;
                    }

                    x() { return parent.x() + 1; }
                    y() { return parent.y() + this.y0; }
                    width() { return parent.width() - 2; }
                    height() { return this.members.length * 20 + 25; }

                    isShown() { return this.members.length > 0; }

                    isEnabled() {
                        return document.getElementById('renameTeamDiv').style.display == 'none'
                    }

                    paint() {
                        if (!thisCanvas.client.state.baseState.serverData || !thisCanvas.client.state.baseState.serverData.players || !thisCanvas.client.state.baseState.serverData.teams) {
                            return
                        }
                        let players = thisCanvas.client.state.baseState.serverData.players
                        let teams = thisCanvas.client.state.baseState.serverData.teams

                        this.members = teams[this.number].members

                        this.interactables = this.members.filter(i => i < players.length).map(i => parent.playerButtons[players[i].id]);

                        if (!this.isShown()) {
                            return;
                        }

                        let x = this.x() - parent.x();
                        let y = this.y() - parent.y();

                        parent.ctx.fillStyle = this.isMoused() && this.interactableMoused === this ? '#C0C0C0' : 'white';
                        drawBox(parent.ctx, x, y, this.width(), this.height(), 10, colors[this.number]);

                        drawText(parent.ctx, teams[this.number].name, x + this.width() / 2, y + 10, 1, 1, font.bold, colors[this.number]);
                        for (let i = 0; i < this.interactables.length; i++) {
                            this.interactables[i].y0 = y + 10 + 20 * (i + 1);
                            this.interactables[i].paint();
                        }
                    }

                    renameTeam() {
                        let newName = document.getElementById('renameTeamName').value
                        if (newName.length == 0) {
                            return false
                        }

                        thisCanvas.client.state.renameTeam(this.number, newName)
                        return true
                    }

                    click() {
                        let myPlayer = thisCanvas.client.state.baseState.myPlayer
                        if (parent.playerSelected !== undefined) {
                            thisCanvas.client.state.reteam(parent.playerSelected.index, this.number);
                            parent.playerSelected = undefined;
                        } else if (!myPlayer.kibitzer) {
                            if (myPlayer.team == this.number) {
                                let popupOld = document.getElementById('renameTeamDiv')
                                let popup = popupOld.cloneNode(true)
                                popupOld.parentNode.replaceChild(popup, popupOld)
                                popup.style.display = 'flex'

                                document.getElementById('renameTeamAccept').addEventListener('click', () => {
                                    let renamed = this.renameTeam()
                                    if (renamed) {
                                        popup.style.display = 'none'
                                    }
                                })
                                document.getElementById('renameTeamName').addEventListener('keydown', e => {
                                    if (e.keyCode == 13) {
                                        let renamed = this.renameTeam()
                                        if (renamed) {
                                            popup.style.display = 'none'
                                        }
                                    }
                                })
                                document.getElementById('renameTeamCancel').addEventListener('click', () => popup.style.display = 'none')
                            } else {
                                thisCanvas.client.state.reteam(myPlayer.index, this.number);
                            }
                        }
                    }
                }

                this.playerButtons = {};
                this.playerSelected = undefined;

                this.teamButtons = [];
                for (let i = 0; i < 10; i++) {
                    // TODO update this dynamically
                    this.teamButtons.push(new TeamButton(i));
                }
                this.interactables = this.teamButtons;
            }

            paint() {
                super.paint();

                if (!thisCanvas.client.state.baseState.serverData || !thisCanvas.client.state.baseState.serverData.players) {
                    return
                }

                for (const player of thisCanvas.client.state.baseState.serverData.players) {
                    if (this.playerButtons[player.id] === undefined) {
                        this.playerButtons[player.id] = new this.PlayerButton(player);
                    }
                }

                let y = 1;
                for (const button of this.teamButtons) {
                    button.y0 = y;
                    button.paint();
                    if (button.isShown()) {
                        y += button.height() + 5;
                    }
                }

                this.element.style.height = y + 'px';
                document.getElementById('teamsDiv').style.height =
                    y + 40
                    + document.getElementById('igNewTeam').clientHeight
                    + document.getElementById('igRandomizeTeams').clientHeight
                    + 'px';
            }
        }
        this.teamsPanel = new TeamsPanel();
        document.getElementById("igNewTeam").addEventListener('click', () => {
            let myPlayer = this.client.state.baseState.myPlayer
            if (this.teamsPanel.playerSelected !== undefined) {
                this.client.state.reteam(this.teamsPanel.playerSelected.index);
                this.teamsPanel.playerSelected = undefined;
            } else if (!myPlayer.kibitzer) {
                this.client.state.reteam(myPlayer.index)
            }
        });
        this.igRandomizeTeams = document.getElementById("igRandomizeTeams")
        this.igRandomizeTeams.addEventListener('click', () => this.client.state.scrambleTeams())

        class Hotdog extends PanelInteractable {
            constructor() {
                super(
                    document.getElementById('igHotdogContainer'),
                    document.getElementById('igHotdogCanvas'),
                    false
                );
            }

            x() { return thisCanvas.scoreSheet.x(); }
            y() { return thisCanvas.scoreSheet.y() + thisCanvas.scoreSheet.height() + 5; }
            width() { return thisCanvas.scoreSheet.width(); }
            height() { return 24; }
            container() { return document.getElementById('inGameDiv'); }

            //isShown() { return mode == 'Oh Hell'; }

            paint() {
                super.paint()
                if (!thisCanvas.client.state.paintHotdog()) {
                    return
                }

                this.clear();
                this.fillContainer();

                let serverData = thisCanvas.client.state.baseState.serverData

                let handSize = serverData.rounds[serverData.roundNumber].handSize;
                let totalBid = 0;
                let totalMaxBidTaken = 0;
                if (serverData.options.teams) {
                    let teams = thisCanvas.client.state.baseState.serverData.teams
                    let state = thisCanvas.client.state
                    totalBid = teams.map(t => state.getTeamBid(t)).reduce((a, b) => a + b, 0)
                    totalMaxBidTaken = teams.map(t => Math.max(state.getTeamBid(t), state.getTeamTaken(t))).reduce((a, b) => a + b, 0)
                } else {
                    totalBid = serverData.players.map(p => p.bidded ? p.bid : 0).reduce((a, b) => a + b, 0);
                    totalMaxBidTaken = serverData.players.map(p => p.bidded ? Math.max(p.bid, p.taken ? p.taken : 0) : 0).reduce((a, b) => a + b, 0);
                }

                let leftMessage = totalBid <= handSize ?
                    'Underbid by: ' + (handSize - totalBid) :
                    'Overbid by: ' + (totalBid - handSize);
                //let rightMessage = totalMaxBidTaken <= handSize ?
                //    'Unwanted tricks: ' + (handSize - totalMaxBidTaken) :
                //    'Excess tricks wanted: ' + (totalMaxBidTaken - handSize);
                let rightMessage = 'Bags: ' + (handSize - totalMaxBidTaken)

                let leftColor = totalBid <= handSize ? 'rgb(0, 0, 120)' : 'rgb(120, 0, 0)';
                let rightColor = totalMaxBidTaken <= handSize ? 'rgb(0, 0, 120)' : 'rgb(120, 0, 0)';
                if (totalMaxBidTaken == handSize) {
                    rightColor = 'rgb(0, 120, 0)';
                }

                drawText(this.ctx, leftMessage, this.width() / 4, this.height() / 2, 1, 1, font.bold, leftColor);
                drawText(this.ctx, rightMessage, 3 * this.width() / 4, this.height() / 2, 1, 1, font.bold, rightColor);
            }
        }
        this.hotdog = new Hotdog();

        class TeamInfo extends PanelInteractable {
            constructor() {
                super(
                    document.getElementById('igTeamInfoContainer'),
                    document.getElementById('igTeamInfoCanvas'),
                    false
                );
            }

            x() { return thisCanvas.scoreSheet.x(); }
            y() { return thisCanvas.scoreSheet.y() + thisCanvas.scoreSheet.height() + 5 + thisCanvas.hotdog.height() + 5; }
            width() { return thisCanvas.scoreSheet.width(); }
            height() { return 24; }
            container() { return document.getElementById('inGameDiv'); }

            isShown() { return thisCanvas.client.state.paintTeamInfo() }

            paint() {
                super.paint();
                if (!thisCanvas.client.state.paintTeamInfo()) {
                    return;
                }

                this.clear();
                this.fillContainer();

                let myPlayer = thisCanvas.client.state.baseState.myPlayer
                let myTeam = thisCanvas.client.state.baseState.serverData.teams[myPlayer.team]
                let bid = thisCanvas.client.state.getTeamBid(myTeam)
                let taken = thisCanvas.client.state.getTeamTaken(myTeam)

                let leftMessage = 'Team bid: ' + bid;
                let rightMessage = 'Team taken: ' + taken;

                let handSize = myPlayer.hand.length;
                if (myPlayer.trick.num != 0) {
                    handSize++;
                }
                let leftColor = bid - taken > handSize ? 'rgb(120, 0, 0)' : 'rgb(0, 0, 120)';
                let rightColor = bid >= taken ? 'rgb(0, 0, 120)' : 'rgb(120, 0, 0)';
                if (bid == taken) {
                    rightColor = 'rgb(0, 120, 0)';
                }

                drawText(this.ctx, leftMessage, this.width() / 4, this.height() / 2, 1, 1, font.bold, leftColor);
                drawText(this.ctx, rightMessage, 3 * this.width() / 4, this.height() / 2, 1, 1, font.bold, rightColor);
            }
        }
        this.teamInfo = new TeamInfo();

        let showCardButton = document.createElement('button');
        showCardButton.innerHTML = 'Show card';
        showCardButton.classList.add(
            'bg-white', 'rounded-lg', 'border', 'border-black', 'w-5', 'h-5',
            'font-bold', 'text-sm', 'select-none', 'hover:bg-gray-300'
        );
        showCardButton.addEventListener('click', () => this.client.state.baseState.showOneCard = true);
        this.showCard = new WrappedDOMElement(showCardButton);
        this.showCard.x = () => (this.client.cachedWidth - this.client.state.baseState.getScoreWidth()) / 2 - 40;
        this.showCard.y = () => this.client.cachedHeight - this.handYOffset - this.showCard.height() / 2;
        this.showCard.width = () => 80;
        this.showCard.height = () => 30;
        this.showCard.container = () => document.getElementById('inGameDiv');
        this.showCard.isShown = () => this.client.state.paintShowCardButton()

        let showSpreadsheetButton = document.createElement('button');
        showSpreadsheetButton.innerHTML = 'Show spreadsheet';
        showSpreadsheetButton.classList.add(
            'bg-white', 'rounded-lg', 'border', 'border-black', 'w-5', 'h-5',
            'font-bold', 'text-sm', 'select-none', 'hover:bg-gray-300'
        );
        showSpreadsheetButton.addEventListener('click', () => this.client.state.toggleShowSpreadsheet());
        this.showSpreadsheet = new WrappedDOMElement(showSpreadsheetButton);
        this.showSpreadsheet.x = () => (this.client.cachedWidth - this.client.state.baseState.getScoreWidth()) / 2 - 300;
        this.showSpreadsheet.y = () => this.client.cachedHeight - (this.showSpreadsheet.height() + 10);
        this.showSpreadsheet.width = () => 150;
        this.showSpreadsheet.height = () => 32;
        this.showSpreadsheet.container = () => document.getElementById('inGameDiv');
        this.showSpreadsheet.isShown = () => this.client.state.paintShowSpreadsheet()

        class Spreadsheet extends PanelInteractable {
            constructor() {
                super(
                    document.getElementById('igSpreadsheetContainer'),
                    document.getElementById('igSpreadsheetCanvas'),
                    false
                );

                this.margin = 4;
                this.rowHeight = 15;
            }

            x() { return (thisCanvas.client.cachedWidth - thisCanvas.client.state.baseState.getScoreWidth()) / 2 - 200; }
            y() { return thisCanvas.client.cachedHeight / 2 - this.height() / 2; }
            width() { return 400; }
            height() { return 2 * this.margin + this.rowHeight * (1 + thisCanvas.client.state.baseState.serverData.players.length); }
            container() { return document.getElementById('inGameDiv'); }

            isShown() { return thisCanvas.client.state.paintSpreadsheet() }

            paint() {
                super.paint();
                if (!this.isShown()) {
                    return;
                }

                this.clear();
                this.fillContainer();

                drawLine(this.ctx, this.width() * 1 / 3, this.margin, this.width() * 1 / 3, this.height() - this.margin);
                drawLine(this.ctx, this.width() * 2 / 3, this.margin, this.width() * 2 / 3, this.height() - this.margin);
                drawText(this.ctx, 'player', this.width() * 1 / 6, this.rowHeight / 2, 1, 1, font.small, 'black');
                drawText(this.ctx, 'cutoff card', this.width() * 1 / 2, this.rowHeight / 2, 1, 1, font.small, 'black');
                drawText(this.ctx, 'bid', this.width() * 5 / 6, this.rowHeight / 2, 1, 1, font.small, 'black');
                drawLine(this.ctx, this.margin, this.rowHeight, this.width() - this.margin, this.rowHeight);

                let data = thisCanvas.client.state.baseState.serverData
                let players = data.players
                let dealer = data.rounds[data.roundNumber].dealer

                let unbidFound = false;
                for (let j = 0; j < players.length; j++) {
                    let i = (dealer + 1 + j) % players.length;

                    drawText(this.ctx, players[i].name, this.width() * 1 / 6, this.rowHeight * (2 * j + 3) / 2, 1, 1, font.small, 'black');
                    let cutoff = !unbidFound || players[i].bidded ? data.spreadsheetSequence.charAt(j) : '';
                    drawText(this.ctx, cutoff, this.width() * 1 / 2, this.rowHeight * (2 * j + 3) / 2, 1, 1, font.small, 'black');
                    let bid = players[i].bidded ? players[i].bid : '';
                    drawText(this.ctx, bid, this.width() * 5 / 6, this.rowHeight * (2 * j + 3) / 2, 1, 1, font.small, 'black');

                    if (!players[i].bidded) {
                        unbidFound = true;
                    }
                }
            }
        }
        this.spreadsheet = new Spreadsheet();

        let undoBidButton = document.createElement('button')
        undoBidButton.innerHTML = 'Undo bid'
        undoBidButton.classList.add(
            'bg-white', 'rounded-lg', 'border', 'border-black', 'w-5', 'h-5',
            'font-bold', 'text-sm', 'select-none', 'hover:bg-gray-300'
        )
        undoBidButton.addEventListener('click', () => this.client.state.undoBid())
        this.undoBid = new WrappedDOMElement(undoBidButton)
        this.undoBid.width = () => 100
        this.undoBid.height = () => 30
        this.undoBid.x = () => (this.client.cachedWidth - this.client.state.baseState.getScoreWidth()) / 2 - this.undoBid.width() / 2
        this.undoBid.y = () => this.client.cachedHeight - 210 - 80
        this.undoBid.container = () => document.getElementById('inGameDiv')
        this.undoBid.isShown = () => this.client.state.paintUndoBid() && this.bidButtons.length == 0

        // filled out dynamically
        this.bidButtons = [];

        this.interactables = this.interactables.concat([
            [this.scoreSheet],
            [this.showCard, this.showSpreadsheet, this.spreadsheet],
            [this.teamsPanel],
            [this.hotdog, this.teamInfo],
            [this.undoBid],
            this.bidButtons
        ])
    }

    customPaintFirst() {
        super.customPaintFirst()
        this.updateBidInteractables()
        this.paintTrump();
    }

    // One model menu per AI Trained bot, listing the models (from the server's
    // trained_ai catalog) that have a version for this many players and decks.
    renderTrainedModels() {
        const state = this.client.state.baseState
        const options = state.serverData && state.serverData.options
        const row = document.getElementById("trainedModelsRow")
        if (!options || !this.trainedModelsDiv || !row) return
        const count = parseInt(options.trainedRobots) || 0
        const catalog = options.trainedCatalog || []
        const N = state.serverData.players ? state.serverData.players.length : 0
        const D = options.D == 2 ? 2 : 1
        const chosen = options.trainedModels || []
        row.style.display = count > 0 && document.getElementById("trainedOptionsRow").style.display != 'none' ? 'table-row' : 'none'
        const sig = JSON.stringify([count, N, D, chosen, catalog.map(m => m.id), !!(state.myPlayer && state.myPlayer.host)])
        if (sig == this.trainedModelsSig) return
        this.trainedModelsSig = sig
        this.trainedModelsDiv.innerHTML = ''
        for (let k = 0; k < count; k++) {
            const current = chosen[k] || 'champion'
            const sel = document.createElement('select')
            sel.className = 'bg-white rounded-lg border border-black h-6 text-sm mb-1'
            for (const m of catalog) {
                const ok = (m.decks[D] || []).includes(N)
                if (!ok && m.id != current) continue
                const o = document.createElement('option')
                o.value = m.id
                o.textContent = m.name + (ok ? '' : ` (no ${N}-player${D == 2 ? ' double-deck' : ''} version)`)
                sel.appendChild(o)
            }
            sel.value = current
            sel.disabled = !(state.myPlayer && state.myPlayer.host)
            sel.addEventListener('change', () => {
                const models = []
                for (let i = 0; i < count; i++) models.push(chosen[i] || 'champion')
                models[k] = sel.value
                this.client.state.sendOptionsUpdate({ trainedModels: models })
            })
            const line = document.createElement('div')
            line.appendChild(document.createTextNode(`${k + 1}: `))
            line.appendChild(sel)
            this.trainedModelsDiv.appendChild(line)
        }
    }

    updateHostOptions() {
        if (!this.client.state.baseState.myPlayer) {
            return
        }
        if (!this.client.state.baseState.myPlayer.host) {
            this.robotsSpinner.disabled = true
            this.trainedRobotsSpinner.disabled = true
            this.doubleDeckCheckBox.disabled = true
            this.teamsCheckBox.disabled = true
            disableButton(this.igStart)
            disableButton(this.igRandomizeTeams)
        } else {
            this.robotsSpinner.disabled = false
            this.trainedRobotsSpinner.disabled = false
            this.doubleDeckCheckBox.disabled = false
            this.teamsCheckBox.disabled = false
            enableButton(this.igStart)
            enableButton(this.igRandomizeTeams)
        }
    }

    paintTrump() {
        if (!this.client.state.paintTrump()) {
            return;
        }

        let x = 50;
        let y = 66;

        drawCard(this.client.ctx, new Card(), x - 4, y - 4, 1, this.client.vars.deckImgSmall, false, -1, undefined);
        drawCard(this.client.ctx, new Card(), x - 2, y - 2, 1, this.client.vars.deckImgSmall, false, -1, undefined);
        drawCard(this.client.ctx, this.client.state.baseState.serverData.trump, x, y, 1, this.client.vars.deckImgSmall, false, -1, undefined);
    }

    updateBidInteractables() {
        let paintBidInteractables = this.client.state.paintBidInteractables()
        if (this.bidButtons.length == 0 && paintBidInteractables) {
            this.makeBidInteractables()
        } else if (this.bidButtons.length > 0 && !paintBidInteractables) {
            this.removeBidInteractables()
        }
    }

    makeBidInteractables() {
        this.bidButtons.length = 0;
        let baseState = this.client.state.baseState
        let myPlayer = baseState.myPlayer
        let serverData = baseState.serverData

        for (let i = 0; i <= myPlayer.hand.length; i++) {
            let button = document.createElement('button');
            button.innerHTML = i
            button.classList.add(
                'rounded-lg', 'border', 'border-black', 'w-5', 'h-5',
                'font-bold', 'text-sm', 'select-none'
            );

            let wrappedButton = new WrappedDOMElement(button);
            wrappedButton.x = () => (this.client.cachedWidth - baseState.getScoreWidth()) / 2 + i * 40 - myPlayer.hand.length * 40 / 2 - 15
            wrappedButton.y = () => this.client.cachedHeight - 210 - 80
            wrappedButton.width = () => 30
            wrappedButton.height = () => 30
            wrappedButton.container = () => document.getElementById('inGameDiv')
            wrappedButton.isEnabled = () => !baseState.isItMyTurn() || i != this.client.state.cannotBid

            wrappedButton.currentState = { 'name': 'none', 'classes': [] }
            wrappedButton.nextState = undefined
            wrappedButton.update = () => {
                if (baseState.preselected.empty() && baseState.isItMyTurn()) {
                    let teamBid = 0
                    if (serverData.options.teams) {
                        teamBid = serverData.teams[myPlayer.team].members.map(i => serverData.players[i].bidded ? serverData.players[i].bid : 0).reduce((a, b) => a + b, 0)
                    }
                    let highestMakeableBid = myPlayer.hand.length - teamBid
                    let totalBid = serverData.players.map(p => p.bidded ? p.bid : 0).reduce((a, b) => a + b, 0)
                    let dealer = serverData.players[serverData.rounds[serverData.roundNumber].dealer]

                    if (i > highestMakeableBid) {
                        wrappedButton.nextState = { 'name': 'active', 'classes': ['bg-red-300', 'hover:bg-red-500', 'border-solid'] }
                    } else if (serverData.options.teams && i == highestMakeableBid && totalBid == teamBid && dealer.team == myPlayer.team && dealer.index != myPlayer.index) {
                        wrappedButton.nextState = { 'name': 'active', 'classes': ['bg-yellow-400', 'hover:bg-yellow-600', 'border-solid'] }
                    } else {
                        wrappedButton.nextState = { 'name': 'active', 'classes': ['bg-white', 'hover:bg-gray-300', 'border-solid'] }
                    }
                } else if (wrappedButton.preselection !== undefined) {
                    wrappedButton.nextState = { 'name': 'preselected', 'classes': ['bg-white', 'hover:bg-gray-300', 'border-dashed'] }
                } else {
                    wrappedButton.nextState = { 'name': 'preselectable', 'classes': ['hover:bg-gray-400', 'border-dashed'] }
                }

                if (wrappedButton.currentState.name == wrappedButton.nextState.name) {
                    return
                }

                for (let c of wrappedButton.currentState.classes) {
                    button.classList.remove(c)
                }
                wrappedButton.currentState = wrappedButton.nextState
                for (let c of wrappedButton.currentState.classes) {
                    button.classList.add(c)
                }
            }

            wrappedButton.preselectX = () => wrappedButton.x() + wrappedButton.width() / 2
            wrappedButton.preselectY = () => wrappedButton.y() - wrappedButton.height() / 2 - 5
            wrappedButton.preselectCheck = () => this.client.state.checkIfShouldBidPreselected()
            wrappedButton.preselectPass = () => i != this.client.state.cannotBid
            wrappedButton.preselectAction = () => {
                this.client.state.makeBid(i)
                this.removeBidInteractables()
            }

            button.addEventListener('click', () => {
                if (!wrappedButton.currentState) {
                    return
                }

                if (wrappedButton.preselection == undefined) {
                    baseState.preselected.clear(0)
                    baseState.preselected.push(wrappedButton)
                } else {
                    baseState.preselected.clear(0)
                }
            })

            this.bidButtons.push(wrappedButton);
        }
    }

    removeBidInteractables() {
        for (let button of this.bidButtons) {
            button.dispose()
        }
        this.bidButtons.length = 0
    }

    createPostGamePage() {
        return new OhHellPostGamePage(this)
    }
}

class OhHellPostGamePage extends PostGamePage {
    constructor(canvas) {
        super(canvas)

        this.addTab(PostGameSummaryTab, document.getElementById("igSummary"))
        this.addTab(PostGameBidsTab, document.getElementById("igBids"))
        this.addTab(OhHellPostGamePlaysTab, document.getElementById("igPlays"))
    }
}

class OhHellPostGamePlaysTab extends PostGameTab {
    constructor(page, index) {
        super(page, index);

        this.elements = [
            document.getElementById("igPlaysTabContainer")
        ];

        this.headerHeight = 35;
        this.margin = 4;
        this.columnXs = [
            3 / 16, 5.5 / 16, 5 / 8, 7 / 8
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
        this.wants = new Array(this.players.length);
        for (let i = 0; i < this.players.length; i++) {
            let player = this.players[i];
            this.hands[i] = new Array(this.numRounds);
            this.playIndices[i] = new Array(this.numRounds);
            this.wants[i] = new Array(this.numRounds);
            for (let j = 0; j < this.numRounds; j++) {
                this.hands[i][j] = new Array(this.numTricks[j]);
                this.playIndices[i][j] = new Array(this.numTricks[j]);
                this.wants[i][j] = new Array(this.numTricks[j]);

                let hand = player.hands[j];
                let want = player.bids[j];
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
                    this.wants[i][j][k] = want;
                    if (i == this.winners[j][k]) {
                        want--;
                    }
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
        drawText(ctx, 'trump', width * this.columnXs[0], this.headerHeight / 2, 1, 1, font.small, 'black');
        drawText(ctx, 'led/won', width * this.columnXs[1], this.headerHeight / 2, 1, 1, font.small, 'black');
        drawText(ctx, 'hand', width * this.columnXs[2], this.headerHeight / 2, 1, 1, font.small, 'black');
        drawText(ctx, 'tricks wanted', width * this.columnXs[3], this.headerHeight / 2, 1, 1, font.small, 'black');
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

            // trump
            if (player.index == this.dealers[this.selected0]) {
                drawCard(ctx, new Card(), width * this.columnXs[0] - 4, h0 + 30 - 4, smallCardScale, deckImgSmall, false, h0 + h / 2, undefined);
                drawCard(ctx, new Card(), width * this.columnXs[0] - 2, h0 + 30 - 2, smallCardScale, deckImgSmall, false, h0 + h / 2, undefined);
                drawCard(ctx, this.trumps[this.selected0], width * this.columnXs[0], h0 + 30, smallCardScale, deckImgSmall, false, h0 + h / 2, undefined);
            }

            // leader/winner/claim
            let leader = player.index == this.leaders[this.selected0][this.selected1];
            let winner = player.index == this.winners[this.selected0][this.selected1];
            let claimer = player.index == this.claims[this.selected0] && this.selected1 == this.numTricks[this.selected0] - 1;
            if (leader) {
                ctx.fillStyle = 'rgb(200, 200, 200)';
                drawOval(ctx, width * this.columnXs[1] - 8 - (winner ? 10 : 0) - (claimer ? 30 : 0), h0 - 8, 16, 16);
                drawText(ctx, '>', width * this.columnXs[1] - (winner ? 10 : 0) - (claimer ? 30 : 0), h0, 1, 1, font.basic, 'black');
            }
            if (winner) {
                ctx.fillStyle = 'rgb(175, 175, 0)';
                drawOval(ctx, width * this.columnXs[1] - 8 + (leader ? 10 : 0), h0 - 8, 16, 16);
                drawText(ctx, 'w', width * this.columnXs[1] + (leader ? 10 : 0), h0, 1, 1, font.basic, 'black');
            }
            if (claimer) {
                ctx.fillStyle = 'rgb(225, 175, 225)';
                drawOval(ctx, width * this.columnXs[1] - 25 + (leader ? 10 : 0), h0 - 12, 50, 24);
                drawText(ctx, 'claim', width * this.columnXs[1] + (leader ? 10 : 0), h0, 1, 1, font.basic, 'black');
            }

            // hand
            let hand = this.hands[i][this.selected0][this.selected1];
            for (let j = 0; j < hand.length; j++) {
                drawCard(ctx,
                    hand[j],
                    width * this.columnXs[2] + 30 * (j - (hand.length - 1) / 2),
                    h0 + h / 2 + 15 - (j == this.playIndices[i][this.selected0][this.selected1] ? 15 : 0),
                    smallCardScale, deckImgSmall, false, h0 + h / 2, undefined);
            }
            for (let j = 0; j < hand.length; j++) {
                let x = width * this.columnXs[2] + 30 * (j - (hand.length - 1) / 2);
                let prob = this.selected1 < player.makingProbs[this.selected0].length ? player.makingProbs[this.selected0][this.selected1][j][1] : -1;
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
            let want = this.wants[i][this.selected0][this.selected1] !== undefined ? this.wants[i][this.selected0][this.selected1] : '--';
            drawText(ctx, want, width * this.columnXs[3], h0, 1, 1, font.basic, 'black');
        }
    }

    paint() {
        this.panel.paint();
    }
}