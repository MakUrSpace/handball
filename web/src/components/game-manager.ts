/**
 * A-Frame Component: handball-game-manager
 * Authoritative client match rules, scoring state machine, rally tracker, and audio dispatcher.
 */

import { soundEngine } from './spatial-audio';
import { COURT_DIMENSIONS } from './court';
import type { MatchSnapshot, MatchState, MatchStats, MatchSettings } from '../types';

declare const AFRAME: any;
declare const THREE: any;

AFRAME.registerComponent('handball-game-manager', {
  schema: {
    targetScore: { type: 'number', default: 21 },
    autoRallyBot: { type: 'boolean', default: false }, // AI practice returner
  },

  init: function () {
    this.ballEl = document.querySelector('#handball');
    this.arenaTextEl = document.querySelector('#scoreboard-text');
    this.arenaDigitsEl = document.querySelector('#scoreboard-digits');

    this.state = 'Idle' as MatchState;
    this.playerScore = 0;
    this.opponentScore = 0;
    this.currentServer = 'Server';
    this.floorBounces = 0;
    this.frontWallHit = false;
    this.currentRallyShots = 0;
    this.lastMessage = 'Ready to Play';

    this.stats = {
      total_rallies: 0,
      longest_rally: 0,
      current_rally_shots: 0,
      max_ball_speed_mph: 0,
      total_aces: 0,
      kill_shots: 0,
    } as MatchStats;

    this.settings = {
      target_score: this.data.targetScore,
      win_by_two: true,
      auto_serve: false,
      rally_scoring: true,
    } as MatchSettings;

    // Listen to ball events
    if (this.ballEl) {
      this.ballEl.addEventListener('ball-collision', (e: any) => this.onBallCollision(e.detail));
      this.ballEl.addEventListener('ball-struck', (e: any) => this.onBallStruck(e.detail));
    }

    this.updateScoreboardDisplay();
  },

  startGame: function () {
    this.state = 'Serving';
    this.playerScore = 0;
    this.opponentScore = 0;
    this.currentRallyShots = 0;
    this.stats = {
      total_rallies: 0,
      longest_rally: 0,
      current_rally_shots: 0,
      max_ball_speed_mph: 0,
      total_aces: 0,
      kill_shots: 0,
    };
    this.lastMessage = 'Game Started! Swing at the ball or press Serve.';
    soundEngine.playWhistle(false);

    if (this.ballEl) {
      const physics = this.ballEl.components['handball-physics'];
      if (physics) physics.resetBall(0.2, 1.25, 6.2);
    }

    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  serveBall: function () {
    if (this.state === 'GameOver') return;
    this.state = 'InPlay';
    this.floorBounces = 0;
    this.frontWallHit = false;
    this.lastMessage = 'Serving into play!';
    soundEngine.playWhistle(false);

    if (this.ballEl) {
      const physics = this.ballEl.components['handball-physics'];
      if (physics) {
        physics.resetBall(0.0, 1.25, 6.2);
        physics.velocity.set(0, 2.8, -13.5);
      }
    }

    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  togglePause: function () {
    if (this.state === 'Paused') {
      this.state = 'InPlay';
      this.lastMessage = 'Game Resumed';
      if (this.ballEl) this.ballEl.setAttribute('handball-physics', 'active', true);
    } else if (this.state === 'InPlay' || this.state === 'Serving') {
      this.state = 'Paused';
      this.lastMessage = 'Game Paused';
      if (this.ballEl) this.ballEl.setAttribute('handball-physics', 'active', false);
    }
    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  resetGame: function () {
    this.state = 'Idle';
    this.playerScore = 0;
    this.opponentScore = 0;
    this.currentRallyShots = 0;
    this.floorBounces = 0;
    this.frontWallHit = false;
    this.lastMessage = 'VR Handball // Ready to Play';

    if (this.ballEl) {
      const physics = this.ballEl.components['handball-physics'];
      if (physics) {
        physics.resetBall(0.2, 1.25, 6.2);
        this.ballEl.setAttribute('handball-physics', 'active', true);
      }
    }

    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  onBallStruck: function (detail: any) {
    if (this.state === 'GameOver' || this.state === 'Paused') return;

    this.floorBounces = 0;
    this.frontWallHit = false;
    this.currentRallyShots++;
    this.stats.current_rally_shots = this.currentRallyShots;

    if (detail.speedMph > this.stats.max_ball_speed_mph) {
      this.stats.max_ball_speed_mph = detail.speedMph;
    }

    if (detail.quality === 'KillShot') {
      this.stats.kill_shots++;
      this.lastMessage = `🔥 KILL SHOT! ${detail.speedMph.toFixed(1)} MPH`;
    } else {
      this.lastMessage = `Strike! ${detail.speedMph.toFixed(1)} MPH (${detail.quality})`;
    }

    if (this.state === 'Serving' || this.state === 'Idle') {
      this.state = 'InPlay';
    }

    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  onBallCollision: function (detail: any) {
    if (detail.surface === 'front-wall') {
      this.frontWallHit = true;
      this.floorBounces = 0;
    } else if (detail.surface === 'floor') {
      this.floorBounces++;
    }
  },

  handleFault: function (reason: string) {
    this.state = 'Fault';
    this.lastMessage = reason;
    soundEngine.playFaultBuzzer();

    if (this.settings.rally_scoring) {
      this.opponentScore++;
      this.checkGameOver();
    }

    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  handleRallyEnd: function (playerWon: boolean, reason: string) {
    this.stats.total_rallies++;
    if (this.currentRallyShots > this.stats.longest_rally) {
      this.stats.longest_rally = this.currentRallyShots;
    }

    if (playerWon) {
      this.playerScore++;
      this.state = 'PointScored';
      this.lastMessage = `Point Scored! (${reason})`;
      soundEngine.playPointScored();
    } else {
      this.opponentScore++;
      this.state = 'PointScored';
      this.lastMessage = `Point Opponent (${reason})`;
      soundEngine.playFaultBuzzer();
    }

    this.currentRallyShots = 0;
    this.stats.current_rally_shots = 0;
    this.checkGameOver();
    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  checkGameOver: function () {
    const target = this.settings.target_score;
    const p = this.playerScore;
    const o = this.opponentScore;

    const isWon = p >= target && p >= o + 2;
    const isLost = o >= target && o >= p + 2;

    if (isWon || isLost) {
      this.state = 'GameOver';
      if (isWon) {
        this.lastMessage = `🏆 VICTORY! Match Won: ${p} - ${o}`;
        soundEngine.playGameWon();
      } else {
        this.lastMessage = `MATCH OVER. Final Score: ${p} - ${o}`;
        soundEngine.playFaultBuzzer();
      }
    }
  },

  updateScoreboardDisplay: function () {
    if (this.arenaTextEl) {
      this.arenaTextEl.setAttribute('value', this.lastMessage.toUpperCase());
    }
    if (this.arenaDigitsEl) {
      this.arenaDigitsEl.setAttribute(
        'value',
        `PLAYER: ${this.playerScore}   |   RALLY: ${this.currentRallyShots}   |   OPPONENT: ${this.opponentScore}`
      );
    }
  },

  emitStateChange: function () {
    const snapshot = this.getSnapshot();
    this.el.emit('match-state-change', snapshot);
  },

  getSnapshot: function (): MatchSnapshot {
    const physics = this.ballEl?.components['handball-physics'];
    const ballPos = this.ballEl?.object3D.position || { x: 0, y: 1.2, z: 5.0 };
    const ballVel = physics?.velocity || { x: 0, y: 0, z: 0 };
    const speedMph = physics ? physics.getSpeedMph() : 0;

    return {
      state: this.state,
      player_score: this.playerScore,
      opponent_score: this.opponentScore,
      current_server: this.currentServer,
      current_rally: this.currentRallyShots,
      last_event_message: this.lastMessage,
      ball_position: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
      ball_velocity: { x: ballVel.x, y: ballVel.y, z: ballVel.z },
      ball_speed_mph: speedMph,
      floor_bounces_since_hit: this.floorBounces,
      front_wall_hit_this_turn: this.frontWallHit,
      stats: this.stats,
      settings: this.settings,
    };
  },
});
