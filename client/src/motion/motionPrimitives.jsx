import { forwardRef, useEffect, useState } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, X } from "lucide-react";
import {
  ARC_EASE,
  ELASTIC_TAP_SPRING,
  FOLLOW_THROUGH_SPRING,
  MICRO_EASE,
  SMOOTH_EASE,
  TIMINGS,
} from "./motionTokens";

// Principle 06 (Slow In, Slow Out) + Principle 05 (Follow Through)
export const PageTransition = forwardRef(function PageTransition(
  { children, pageKey },
  ref
) {
  return (
    <motion.div
      ref={ref}
      key={pageKey}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: TIMINGS.page, ease: SMOOTH_EASE }}
    >
      {children}
    </motion.div>
  );
});

// Principle 01 (Squash & Stretch) + Principle 09 (Snappy Timing)
export function MotionButton({
  children,
  className = "primary-btn",
  type = "button",
  disabled = false,
  onClick,
  style,
  ariaLabel,
  anticipate = false,
}) {
  return (
    <motion.button
      type={type}
      className={className}
      disabled={disabled}
      onClick={onClick}
      style={style}
      aria-label={ariaLabel}
      whileHover={
        disabled
          ? undefined
          : {
              y: -2,
              scale: anticipate ? 1.03 : 1.02,
              transition: { duration: TIMINGS.snappy, ease: MICRO_EASE },
            }
      }
      whileTap={
        disabled
          ? undefined
          : {
              scaleX: 0.95,
              scaleY: 0.93,
              transition: ELASTIC_TAP_SPRING,
            }
      }
    >
      {children}
    </motion.button>
  );
}

export function StaggerGrid({ children, className = "stats-grid", style }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: 0.08,
            delayChildren: 0.04,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

// Principle 01 (Squash & Stretch) + Principle 06 (Slow In, Slow Out)
export function StaggerCard({ children, className = "stat-card", style }) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={{
        hidden: { opacity: 0, y: 24, scale: 0.96 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { duration: TIMINGS.page, ease: SMOOTH_EASE },
        },
      }}
      whileHover={{
        y: -4,
        scale: 1.015,
        boxShadow: "0 16px 36px rgba(23, 100, 95, 0.13)",
        transition: { duration: TIMINGS.micro, ease: MICRO_EASE },
      }}
      whileTap={{
        scale: 0.985,
        transition: ELASTIC_TAP_SPRING,
      }}
    >
      {children}
    </motion.div>
  );
}

// Smooth viewport-triggered section container with natural hover response
export function MotionSectionCard({ children, className = "panel", style }) {
  return (
    <motion.section
      className={className}
      style={style}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: TIMINGS.page, ease: SMOOTH_EASE }}
      whileHover={{
        y: -2,
        boxShadow: "0 14px 34px rgba(23, 100, 95, 0.1)",
        transition: { duration: TIMINGS.micro, ease: MICRO_EASE },
      }}
    >
      {children}
    </motion.section>
  );
}

// Natural crossfade from loading skeletons into real loaded content
export function LoadingCrossfade({ loading, skeleton, children, sectionKey }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {loading ? (
        <motion.div
          key={`${sectionKey}-loading`}
          initial={{ opacity: 0.7 }}
          animate={{ opacity: 1 }}
          exit={{
            opacity: 0,
            y: -4,
            transition: { duration: TIMINGS.snappy, ease: MICRO_EASE },
          }}
        >
          {skeleton}
        </motion.div>
      ) : (
        <motion.div
          key={`${sectionKey}-ready`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: TIMINGS.card, ease: SMOOTH_EASE }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Principle 07 (Moving in Arcs)
export function ArcMotionItem({
  children,
  className = "item-row",
  index = 0,
  style,
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, x: 16, y: 18 }}
      whileInView={{
        opacity: 1,
        x: [16, 4, 0],
        y: [18, -2, 0],
      }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{
        duration: TIMINGS.page,
        delay: Math.min(index * 0.06, 0.3),
        ease: ARC_EASE,
      }}
      whileHover={{
        y: -2,
        scale: 1.006,
        boxShadow: "0 8px 20px rgba(23, 100, 95, 0.08)",
        transition: { duration: TIMINGS.snappy, ease: MICRO_EASE },
      }}
      whileTap={{
        scale: 0.99,
        transition: ELASTIC_TAP_SPRING,
      }}
    >
      {children}
    </motion.div>
  );
}

// Principle 03 (Staging the Focus)
export const FocusStageCard = forwardRef(function FocusStageCard(
  { children, focused = true, className = "panel", style },
  ref
) {
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
        boxShadow: focused
          ? "0 16px 38px rgba(23, 100, 95, 0.12)"
          : "0 8px 28px rgba(23, 100, 95, 0.06)",
      }}
      exit={{ opacity: 0, scale: 0.97, y: -10 }}
      transition={FOLLOW_THROUGH_SPRING}
      style={style}
    >
      {children}
    </motion.div>
  );
});

// Principle 04 (Pose-to-Pose) State Rail
export function PoseStepRail({ poses, activePose }) {
  return (
    <div className="pose-rail" role="status" aria-label={`Current state: ${activePose}`}>
      {poses.map((pose) => {
        const isActive = pose.key === activePose;
        return (
          <div
            key={pose.key}
            className={`pose-step ${isActive ? "active" : ""}`}
          >
            {isActive && (
              <motion.span
                layoutId="ai-pose-pill"
                className="pose-step-bg"
                transition={FOLLOW_THROUGH_SPRING}
              />
            )}
            <span className="pose-step-label">{pose.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Principle 05 (Follow Through) for Expandable Drawers/Panels
export function FollowThroughDrawer({ isOpen, children, style }) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: "auto", y: 0 }}
          exit={{ opacity: 0, height: 0, y: -4 }}
          transition={FOLLOW_THROUGH_SPRING}
          style={{ overflow: "hidden", ...style }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AnimatedProgressBar({ percent = 0, variant = "teal" }) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const variantClass =
    variant === "coral" ? "coral" : variant === "amber" ? "amber" : "";

  return (
    <div className="bar-track">
      <motion.div
        className={`bar-fill ${variantClass}`}
        initial={{ width: 0 }}
        whileInView={{ width: `${safePercent}%` }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: TIMINGS.sequence, ease: SMOOTH_EASE }}
      />
    </div>
  );
}

export function AnimatedValue({ value, format, children }) {
  const numericTarget = Number(value);
  const canCount = typeof value === "number" && Number.isFinite(numericTarget);
  const prefersReduced = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(
    canCount && !prefersReduced && numericTarget !== 0 ? 0 : numericTarget
  );

  useEffect(() => {
    if (!canCount || prefersReduced || numericTarget === 0) {
      return undefined;
    }
    const controls = animate(0, numericTarget, {
      duration: TIMINGS.sequence,
      ease: SMOOTH_EASE,
      onUpdate: (latest) => setDisplayValue(Math.round(latest)),
    });
    return () => controls.stop();
  }, [canCount, numericTarget, prefersReduced]);

  const currentNumber =
    prefersReduced || numericTarget === 0 ? numericTarget : displayValue;

  const content =
    canCount && format
      ? format(currentNumber)
      : children !== undefined
        ? children
        : canCount
          ? currentNumber
          : value;

  return (
    <motion.span
      key={canCount ? `num-${numericTarget}` : String(value)}
      initial={{ opacity: 0.45, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: TIMINGS.card, ease: MICRO_EASE }}
      style={{ display: "inline-block" }}
    >
      {content}
    </motion.span>
  );
}

// Principle 08 (Secondary Action) animated status badge
export function StatusPill({ statusKey, className, children }) {
  return (
    <motion.span
      key={String(statusKey)}
      className={className}
      initial={{ opacity: 0.5, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={ELASTIC_TAP_SPRING}
    >
      {children}
    </motion.span>
  );
}

// Principle 10 (Exaggerated Feedback — professional animated checkmark draw-in)
export function SuccessFeedbackBanner({ message, onDismiss }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={FOLLOW_THROUGH_SPRING}
          className="success-celebration-banner"
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
            <span className="success-check-ring" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <motion.path
                  d="M5 13l4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.36, delay: 0.08, ease: SMOOTH_EASE }}
                />
              </svg>
            </span>
            <strong>{message}</strong>
          </span>
          {onDismiss && (
            <button
              type="button"
              className="text-btn"
              onClick={onDismiss}
              aria-label="Dismiss success notification"
            >
              <X size={15} />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Principle 10 (Exaggerated Feedback — damped error micro-shake)
export function ErrorFeedbackBanner({ message, onRetry, onDismiss }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role="alert"
          className="error-banner"
          initial={{ opacity: 0, x: 0, y: -6 }}
          animate={{
            opacity: 1,
            y: 0,
            x: [0, -6, 6, -4, 4, 0],
          }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.34, ease: MICRO_EASE }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={16} /> {message}
          </span>
          <div style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
            {onRetry && (
              <button type="button" className="text-btn" onClick={onRetry}>
                Retry
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                className="text-btn"
                onClick={onDismiss}
                aria-label="Dismiss error"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SkeletonStatsGrid({ count = 4 }) {
  return (
    <div className="stats-grid" aria-busy="true" aria-label="Loading summary">
      {Array.from({ length: count }).map((_, idx) => (
        <div className="stat-card" key={idx}>
          <div className="skeleton skeleton-line short" />
          <div className="skeleton skeleton-line tall" style={{ marginTop: "14px" }} />
          <div className="skeleton skeleton-line medium" style={{ marginTop: "10px" }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 3 }) {
  return (
    <div className="item-list" aria-busy="true" aria-label="Loading list">
      {Array.from({ length: rows }).map((_, idx) => (
        <div className="item-row" key={idx}>
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton-line medium" />
            <div className="skeleton skeleton-line long" style={{ marginTop: "8px" }} />
          </div>
          <div className="skeleton skeleton-pill" />
        </div>
      ))}
    </div>
  );
}

export function EmptyStateBox({ message }) {
  return (
    <motion.div
      className="empty"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: TIMINGS.card, ease: MICRO_EASE }}
    >
      {message}
    </motion.div>
  );
}
