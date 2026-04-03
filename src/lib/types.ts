// MediaPipe pose landmark
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

// Calculated joint angles
export interface JointAngles {
  leftShoulder: number;
  rightShoulder: number;
  leftElbow: number;
  rightElbow: number;
  leftHip: number;
  rightHip: number;
  leftKnee: number;
  rightKnee: number;
  spineAngle: number;
  hipAlignment: number;
  shoulderAlignment: number;
}

// Center of gravity
export interface CenterOfGravity {
  x: number;
  y: number;
}

// Analysis issue from Claude
export interface AnalysisIssue {
  priority: number;
  body_part: string;
  description: string;
  ideal_angle?: number;
  actual_angle?: number;
}

// Analysis advice from Claude
export interface AnalysisAdvice {
  type: "training" | "stretch" | "warmup" | "injury_prevention";
  related_issue: number;
  content: string;
}

// Full analysis result
export interface AnalysisResult {
  score: number;
  issues: AnalysisIssue[];
  advice: AnalysisAdvice[];
  summary: string;
}

// Trick definition
export interface Trick {
  id: string;
  name: string;
  name_ja: string;
  category: TrickCategory;
  difficulty: number;
  description: string;
  description_ja: string;
}

export type TrickCategory =
  | "toprock"
  | "footwork"
  | "power_move"
  | "freeze"
  | "acrobatics"
  | "flexibility";

export const TRICK_CATEGORY_LABELS: Record<TrickCategory, string> = {
  toprock: "トップロック",
  footwork: "フットワーク",
  power_move: "パワームーブ",
  freeze: "フリーズ",
  acrobatics: "アクロバット",
  flexibility: "柔軟",
};

// Analysis state
export type AnalysisState =
  | "idle"
  | "uploading"
  | "detecting"
  | "analyzing"
  | "complete"
  | "error";
