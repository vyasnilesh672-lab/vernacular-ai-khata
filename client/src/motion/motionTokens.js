// Principle 06 (Slow In, Slow Out) & Principle 09 (Snappy Timing)
export const MICRO_EASE = [0.22, 1, 0.36, 1];
export const SMOOTH_EASE = [0.16, 1, 0.3, 1];
export const ARC_EASE = [0.25, 0.9, 0.3, 1];

// Principle 01 (Squash & Stretch) & Principle 05 (Follow Through)
export const ELASTIC_TAP_SPRING = {
  type: "spring",
  stiffness: 520,
  damping: 26,
  mass: 0.75,
};

export const FOLLOW_THROUGH_SPRING = {
  type: "spring",
  stiffness: 360,
  damping: 28,
  mass: 0.9,
};

export const TIMINGS = {
  snappy: 0.14,
  micro: 0.18,
  card: 0.26,
  overlay: 0.3,
  page: 0.36,
  sequence: 0.52,
};

// Principle 04 (Pose-to-Pose) for AI Command Lifecycle
export const AI_COMMAND_POSES = [
  { key: "idle", label: "Idle" },
  { key: "recording", label: "Recording" },
  { key: "processing", label: "Processing" },
  { key: "preview", label: "Preview" },
  { key: "confirmed", label: "Confirmed" },
];
