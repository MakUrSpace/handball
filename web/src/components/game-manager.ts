/**
 * A-Frame Component: handball-game-manager
 * Authoritative client match rules, scoring state machine, rally tracker, and audio dispatcher.
 */

import { soundEngine } from './spatial-audio';
import { COURT_DIMENSIONS } from './court';
import type { MatchSnapshot, MatchState, MatchStats, MatchSettings, PlayerRole } from '../types';

declare const AFRAME: any;
declare const THREE: any;

AFRAME.registerComponent('handball-game-manager', {
  schema: {
    targetScore: { type: 'number', default: 21 },
    autoRallyBot: { type: 'boolean', default: true }, // Standard play always uses the bot
    freeplay: { type: 'boolean', default: false },
  },

  init: function () {
    this.ballEl = document.querySelector('#handball');
    this.arenaTextEl = document.querySelector('#scoreboard-text');
    this.arenaDigitsEl = document.querySelector('#scoreboard-digits');
    this.botEl = document.querySelector('#practice-bot');

    this.state = 'Idle' as MatchState;
    this.playerScore = 0;
    this.opponentScore = 0;
    this.currentServer = 'Server';
    this.floorBounces = 0;
    this.frontWallHit = false;
    this.currentRallyShots = 0;
    this.lastHitter = undefined as PlayerRole | undefined;
    this.deadBallSince = 0;
    this.nextRallyTimer = 0;
    this.lastMessage = 'Ready to Play';

    this.stats = {
      total_rallies: 0,
      longest_rally: 0,
      current_rally_shots: 0,
      max_ball_speed_mph: 0,
      total_aces: 0,
      kill_shots: 0,
      center_wall_hits: 0,
      opponent_center_wall_hits: 0,
    } as MatchStats;

    this.settings = {
      target_score: this.data.targetScore,
      win_by_two: true,
      auto_serve: false,
      rally_scoring: true,
      freeplay: this.data.freeplay,
      bot_error_rate: 0.18,
    } as MatchSettings;

    // Listen to ball events
    if (this.ballEl) {
      this.ballEl.addEventListener('ball-collision', (e: any) => this.onBallCollision(e.detail));
      this.ballEl.addEventListener('ball-struck', (e: any) => this.onBallStruck(e.detail));
    }

    this.data.autoRallyBot = !this.data.freeplay;
    this.updateScoreboardDisplay();
    this.setBotEnabled(this.data.autoRallyBot, false);
  },

  remove: function () {
    if (this.nextRallyTimer) window.clearTimeout(this.nextRallyTimer);
  },

  freshStats: function (): MatchStats {
    return {
      total_rallies: 0,
      longest_rally: 0,
      current_rally_shots: 0,
      max_ball_speed_mph: 0,
      total_aces: 0,
      kill_shots: 0,
      center_wall_hits: 0,
      opponent_center_wall_hits: 0,
    };
  },

  startGame: function () {
    if (this.nextRallyTimer) {
      window.clearTimeout(this.nextRallyTimer);
      this.nextRallyTimer = 0;
    }
    this.state = 'Serving';
    this.playerScore = 0;
    this.opponentScore = 0;
    this.currentRallyShots = 0;
    this.floorBounces = 0;
    this.frontWallHit = false;
    this.lastHitter = undefined;
    this.deadBallSince = 0;
    this.stats = this.freshStats();
    this.lastMessage = 'Game Started! Swing at the ball or press Serve.';
    soundEngine.playWhistle(false);

    if (this.ballEl) {
      const physics = this.ballEl.components['handball-physics'];
      if (physics) {
        physics.resetBall(0.2, 1.25, 6.2);
        this.ballEl.setAttribute('handball-physics', 'active', true);
      }
    }
    this.getBot()?.resetForRally();

    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  serveBall: function () {
    if (this.state === 'GameOver') return;
    if (this.nextRallyTimer) {
      window.clearTimeout(this.nextRallyTimer);
      this.nextRallyTimer = 0;
    }
    this.state = 'InPlay';
    this.floorBounces = 0;
    this.frontWallHit = false;
    this.lastHitter = 'Server';
    this.currentRallyShots = 1;
    this.stats.current_rally_shots = 1;
    if (this.data.freeplay && this.stats.longest_rally < 1) this.stats.longest_rally = 1;
    this.deadBallSince = 0;
    this.lastMessage = 'Serving into play!';
    soundEngine.playWhistle(false);

    if (this.ballEl) {
      const physics = this.ballEl.components['handball-physics'];
      if (physics) {
        physics.resetBall(0.0, 1.25, 6.2);
        this.ballEl.setAttribute('handball-physics', 'active', true);
        physics.isHovering = false;
        physics.velocity.set(0, 2.8, -13.5);
      }
    }
    this.getBot()?.resetForRally();

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
    this.lastHitter = undefined;
    this.deadBallSince = 0;
    this.stats = this.freshStats();
    this.lastMessage = 'VR Handball // Ready to Play';

    if (this.nextRallyTimer) {
      window.clearTimeout(this.nextRallyTimer);
      this.nextRallyTimer = 0;
    }

    if (this.ballEl) {
      const physics = this.ballEl.components['handball-physics'];
      if (physics) {
        physics.resetBall(0.2, 1.25, 6.2);
        this.ballEl.setAttribute('handball-physics', 'active', true);
      }
    }
    this.getBot()?.resetForRally();

    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  onBallStruck: function (detail: any) {
    if (this.state === 'GameOver' || this.state === 'Paused' || this.state === 'PointScored' || this.state === 'Fault') return;

    const actor = (detail.actor === 'Opponent' ? 'Receiver' : 'Server') as PlayerRole;
    this.lastHitter = actor;
    this.floorBounces = 0;
    this.frontWallHit = false;
    this.deadBallSince = 0;
    this.currentRallyShots++;
    this.stats.current_rally_shots = this.currentRallyShots;
    if (this.data.freeplay && this.currentRallyShots > this.stats.longest_rally) {
      this.stats.longest_rally = this.currentRallyShots;
    }

    if (detail.speedMph > this.stats.max_ball_speed_mph) {
      this.stats.max_ball_speed_mph = detail.speedMph;
    }

    if (actor === 'Server' && detail.quality === 'KillShot') {
      this.stats.kill_shots++;
      this.lastMessage = `🔥 KILL SHOT! ${detail.speedMph.toFixed(1)} MPH`;
    } else if (actor === 'Server') {
      this.lastMessage = `Strike! ${detail.speedMph.toFixed(1)} MPH (${detail.quality})`;
    } else {
      this.lastMessage = `🤖 Bot return! ${detail.speedMph.toFixed(1)} MPH`;
    }

    if (this.state === 'Serving' || this.state === 'Idle') {
      this.state = 'InPlay';
    }

    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  onBallCollision: function (detail: any) {
    if (this.state !== 'InPlay' && this.state !== 'Serving') return;

    if (detail.surface === 'front-wall') {
      if (!this.frontWallHit) {
        this.frontWallHit = true;
        this.floorBounces = 0;
        this.deadBallSince = 0;
        if (this.isCenterWallHit(detail.position)) this.recordCenterWallHit(detail.position);
        if (this.data.autoRallyBot && this.lastHitter === 'Server') this.getBot()?.notifyIncoming();
        this.lastMessage = this.lastHitter === 'Receiver'
          ? 'Bot found the front wall — your return.'
          : 'Legal front-wall hit!';
      }
    } else if (detail.surface === 'floor') {
      if (this.data.freeplay) {
        this.floorBounces++;
        this.lastMessage = `Freeplay — ${this.floorBounces} floor bounce${this.floorBounces === 1 ? '' : 's'} (rules off)`;
        this.updateScoreboardDisplay();
        this.emitStateChange();
        return;
      }
      if (!this.lastHitter) return;

      if (!this.frontWallHit) {
        const winner = this.lastHitter === 'Server' ? 'Receiver' : 'Server';
        this.handleRallyEnd(winner, 'Floor before front wall');
        return;
      }

      this.floorBounces++;
      if (this.floorBounces === 1) {
        this.lastMessage = 'One bounce — return it now!';
      } else if (this.floorBounces >= 2) {
        this.handleRallyEnd(this.lastHitter, 'Double bounce');
        return;
      }
    }
    this.updateScoreboardDisplay();
    this.emitStateChange();
  },

  tick: function () {
    if (this.data.freeplay) {
      this.deadBallSince = 0;
      return;
    }
    if (this.state !== 'InPlay' || this.frontWallHit === false || this.floorBounces < 1 || !this.lastHitter) {
      this.deadBallSince = 0;
      return;
    }
    const physics = this.ballEl?.components?.['handball-physics'];
    if (!physics || physics.velocity.length() >= 0.38) {
      this.deadBallSince = 0;
      return;
    }
    if (!this.deadBallSince) this.deadBallSince = performance.now();
    if (performance.now() - this.deadBallSince > 450) {
      this.handleRallyEnd(this.lastHitter, 'Dead ball after one bounce');
    }
  },

  isCenterWallHit: function (position: { x: number; y: number }) {
    const radius = COURT_DIMENSIONS.mode === 'narrow' ? 0.42 : 0.67;
    return Math.hypot(position.x, position.y - 1.2) <= radius;
  },

  recordCenterWallHit: function (_position: { x: number; y: number; z: number }) {
    if (this.lastHitter === 'Receiver') {
      this.stats.opponent_center_wall_hits++;
    } else {
      this.stats.center_wall_hits++;
    }
    const target = document.querySelector('#front-wall-target') as any;
    if (target) {
      target.setAttribute('material', 'color', this.lastHitter === 'Receiver' ? '#c084fc' : '#34d399');
      target.setAttribute('scale', '1.18 1.18 1.18');
      window.setTimeout(() => {
        if (!target.isConnected) return;
        target.setAttribute('material', 'color', '#fde047');
        target.setAttribute('scale', '1 1 1');
      }, 220);
    }
    this.el.emit('center-wall-hit', {
      actor: this.lastHitter,
      playerHits: this.stats.center_wall_hits,
      opponentHits: this.stats.opponent_center_wall_hits,
    });
  },

  handleFault: function (reason: string) {
    if (this.data.freeplay) return;
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

  handleRallyEnd: function (winner: PlayerRole, reason: string) {
    if (this.state === 'PointScored' || this.state === 'GameOver') return;
    this.stats.total_rallies++;
    if (this.currentRallyShots > this.stats.longest_rally) {
      this.stats.longest_rally = this.currentRallyShots;
    }

    if (winner === 'Server') {
      this.playerScore++;
      this.state = 'PointScored';
      this.currentServer = 'Server';
      this.lastMessage = `Point Player — ${reason}`;
      soundEngine.playPointScored();
    } else {
      this.opponentScore++;
      this.state = 'PointScored';
      this.currentServer = 'Receiver';
      this.lastMessage = `${this.data.autoRallyBot ? 'Point Bot' : 'Point Opponent'} — ${reason}`;
      soundEngine.playFaultBuzzer();
    }

    this.currentRallyShots = 0;
    this.stats.current_rally_shots = 0;
    this.floorBounces = 0;
    this.frontWallHit = false;
    this.lastHitter = undefined;
    this.deadBallSince = 0;
    if (this.ballEl) this.ballEl.setAttribute('handball-physics', 'active', false);
    this.checkGameOver();
    this.updateScoreboardDisplay();
    this.emitStateChange();
    if (this.state !== 'GameOver') this.scheduleNextRally();
  },

  scheduleNextRally: function () {
    if (this.nextRallyTimer) window.clearTimeout(this.nextRallyTimer);
    this.nextRallyTimer = window.setTimeout(() => {
      this.nextRallyTimer = 0;
      if (this.state === 'GameOver') return;
      const physics = this.ballEl?.components?.['handball-physics'];
      if (physics) physics.resetBall(0.0, 1.25, 6.2);
      if (this.ballEl) this.ballEl.setAttribute('handball-physics', 'active', true);
      this.state = 'Serving';
      this.lastMessage = 'Next rally ready — serve or strike.';
      this.getBot()?.resetForRally();
      this.updateScoreboardDisplay();
      this.emitStateChange();
    }, 1300);
  },

  getBot: function () {
    return this.botEl?.components?.['practice-bot'];
  },

  setBotEnabled: function (enabled: boolean, announce: boolean = true) {
    if (enabled && this.data.freeplay) {
      this.data.freeplay = false;
      this.settings.freeplay = false;
    }
    this.data.autoRallyBot = enabled;
    this.getBot()?.setEnabled(enabled);
    if (announce) {
      this.lastMessage = enabled
        ? 'Practice Bot enabled — place shots away from its reach.'
        : 'Practice Bot disabled — solo rally practice.';
      this.updateScoreboardDisplay();
      this.emitStateChange();
    }
    return enabled;
  },

  setBotErrorRate: function (errorRate: number, announce: boolean = true) {
    const clampedRate = Math.max(0, Math.min(0.95, errorRate));
    const bot = this.getBot();
    const info = bot?.setErrorRate(clampedRate) || {
      label: clampedRate <= 0.001 ? 'PERFECT' : 'CUSTOM',
      errorRate: clampedRate,
      perfect: clampedRate <= 0.001,
    };
    this.settings.bot_error_rate = info.errorRate;
    if (announce) {
      this.lastMessage = info.perfect
        ? 'Bot difficulty: PERFECT — guaranteed returns.'
        : `Bot difficulty: ${info.label} — ${Math.round(info.errorRate * 100)}% error rate.`;
      this.updateScoreboardDisplay();
      this.emitStateChange();
    }
    return info;
  },

  cycleBotDifficulty: function () {
    const bot = this.getBot();
    if (!bot) return this.setBotErrorRate(this.settings.bot_error_rate ?? 0.18);
    const info = bot.cycleDifficulty();
    this.settings.bot_error_rate = info.errorRate;
    this.lastMessage = info.perfect
      ? 'Bot difficulty: PERFECT — guaranteed returns.'
      : `Bot difficulty: ${info.label} — ${Math.round(info.errorRate * 100)}% error rate.`;
    this.updateScoreboardDisplay();
    this.emitStateChange();
    return info;
  },

  setFreeplayEnabled: function (enabled: boolean, announce: boolean = true) {
    this.data.freeplay = enabled;
    this.settings.freeplay = enabled;

    this.data.autoRallyBot = !enabled;
    this.getBot()?.setEnabled(!enabled);
    if (this.nextRallyTimer) {
      window.clearTimeout(this.nextRallyTimer);
      this.nextRallyTimer = 0;
    }

    // A mode boundary starts with a clean ball but preserves match and accuracy totals.
    this.state = 'Serving';
    this.currentRallyShots = 0;
    this.stats.current_rally_shots = 0;
    this.floorBounces = 0;
    this.frontWallHit = false;
    this.lastHitter = undefined;
    this.deadBallSince = 0;
    const physics = this.ballEl?.components?.['handball-physics'];
    if (physics) physics.resetBall(0.0, 1.25, 6.2);
    if (this.ballEl) this.ballEl.setAttribute('handball-physics', 'active', true);
    this.getBot()?.resetForRally();

    if (announce) {
      this.lastMessage = enabled
        ? 'Freeplay enabled — scoring and rally faults are off.'
        : 'Bot play enabled — rally scoring and faults are active.';
      this.updateScoreboardDisplay();
      this.emitStateChange();
    }
    return enabled;
  },

  toggleFreeplay: function () {
    return this.setFreeplayEnabled(!this.data.freeplay);
  },

  checkGameOver: function () {
    const target = this.settings.target_score;
    const p = this.playerScore;
    const o = this.opponentScore;

    const margin = this.settings.win_by_two ? 2 : 1;
    const isWon = p >= target && p >= o + margin;
    const isLost = o >= target && o >= p + margin;

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
    // Court theme/mode changes rebuild the in-world scoreboard, so resolve the
    // current nodes instead of retaining references to detached geometry.
    this.arenaTextEl = document.querySelector('#scoreboard-text');
    this.arenaDigitsEl = document.querySelector('#scoreboard-digits');
    const isNarrow = COURT_DIMENSIONS.mode === 'narrow';
    if (this.arenaTextEl) {
      this.arenaTextEl.setAttribute('value', this.lastMessage.toUpperCase());
    }
    if (this.arenaDigitsEl) {
      this.arenaDigitsEl.setAttribute(
        'value',
        this.data.freeplay
          ? (isNarrow ? 'FREEPLAY • SCORE LOCKED' : 'FREEPLAY    —    SCORE LOCKED')
          : (isNarrow
              ? `YOU ${this.playerScore}  —  ${this.opponentScore} ${this.data.autoRallyBot ? 'BOT' : 'OPP'}`
              : `PLAYER  ${this.playerScore}    —    ${this.opponentScore}  ${this.data.autoRallyBot ? 'BOT' : 'OPPONENT'}`)
      );
    }
    const rallyEl = document.querySelector('#scoreboard-rally');
    if (rallyEl) rallyEl.setAttribute(
      'value',
      isNarrow
        ? `RALLY ${this.currentRallyShots}  •  PLAYED ${this.stats.total_rallies}`
        : `RALLY SHOTS: ${this.currentRallyShots}   •   RALLIES PLAYED: ${this.stats.total_rallies}`
    );
    const accuracyEl = document.querySelector('#scoreboard-accuracy');
    if (accuracyEl) accuracyEl.setAttribute(
      'value',
      isNarrow
        ? `CENTER ${this.stats.center_wall_hits}  •  BEST ${this.stats.longest_rally}`
        : `CENTER HITS: ${this.stats.center_wall_hits}   •   BEST RALLY: ${this.stats.longest_rally}`
    );
    const botEl = document.querySelector('#scoreboard-bot');
    const botDifficulty = this.getBot()?.getDifficultyInfo?.().label || 'MEDIUM';
    if (botEl) botEl.setAttribute(
      'value',
      this.data.freeplay ? 'FREEPLAY • RULES OFF' : (this.data.autoRallyBot ? `BOT ${botDifficulty} • RULES ON` : 'RALLY RULES ACTIVE')
    );
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
      last_hitter: this.lastHitter,
      bot_enabled: this.data.autoRallyBot,
      freeplay_enabled: this.data.freeplay,
      bot_difficulty: this.getBot()?.getDifficultyInfo?.().label || 'MEDIUM',
      bot_error_rate: this.settings.bot_error_rate,
      stats: this.stats,
      settings: this.settings,
    };
  },
});
