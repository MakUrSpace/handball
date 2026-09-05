export type MatchState =
  | 'Idle'
  | 'Serving'
  | 'InPlay'
  | 'PointScored'
  | 'SideOut'
  | 'Fault'
  | 'Paused'
  | 'GameOver';

export type PlayerRole = 'Server' | 'Receiver';

export type HitQuality = 'KillShot' | 'Solid' | 'Glancing' | 'Soft';

export type HandSide = 'Left' | 'Right';

export interface Vec3D {
  x: number;
  y: number;
  z: number;
}

export interface MatchStats {
  total_rallies: number;
  longest_rally: number;
  current_rally_shots: number;
  max_ball_speed_mph: number;
  total_aces: number;
  kill_shots: number;
  center_wall_hits: number;
  opponent_center_wall_hits: number;
}

export interface MatchSettings {
  target_score: number;
  win_by_two: boolean;
  auto_serve: boolean;
  rally_scoring: boolean;
  freeplay: boolean;
  bot_error_rate: number;
}

export interface MatchSnapshot {
  state: MatchState;
  player_score: number;
  opponent_score: number;
  current_server: PlayerRole;
  current_rally: number;
  last_event_message: string;
  ball_position: Vec3D;
  ball_velocity: Vec3D;
  ball_speed_mph: number;
  floor_bounces_since_hit: number;
  front_wall_hit_this_turn: boolean;
  last_hitter?: PlayerRole;
  bot_enabled?: boolean;
  freeplay_enabled?: boolean;
  bot_difficulty?: string;
  bot_error_rate?: number;
  stats: MatchStats;
  settings: MatchSettings;
}

export interface StrikeEvent {
  side: HandSide;
  speedMps: number;
  speedMph: number;
  quality: HitQuality;
  point: Vec3D;
}
