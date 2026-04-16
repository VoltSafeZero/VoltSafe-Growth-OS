import { useRef, useState } from "react";

type Action = {
  label: string;
  icon: React.ElementType;
  color: string;
  testId: string;
  onClick: () => void;
};

type Props = {
  actions: Action[];
  children: React.ReactNode;
  className?: string;
  testId?: string;
};

const SWIPE_THRESHOLD = 60;
const MAX_SLIDE = 220;

export function SwipeActionCard({ actions, children, className = "", testId }: Props) {
  const startXRef = useRef<number | null>(null);
  const currentXRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null) return;
    const dx = startXRef.current - e.touches[0].clientX;
    if (dx < 0 && !revealed) return;
    const newOffset = revealed
      ? Math.max(0, Math.min(MAX_SLIDE, actions.length * 64 + (dx)))
      : Math.max(0, Math.min(MAX_SLIDE, dx));
    currentXRef.current = newOffset;
    setOffset(newOffset);
  };

  const handleTouchEnd = () => {
    if (currentXRef.current > SWIPE_THRESHOLD) {
      const snap = Math.min(actions.length * 64, MAX_SLIDE);
      setOffset(snap);
      setRevealed(true);
    } else {
      setOffset(0);
      setRevealed(false);
    }
    startXRef.current = null;
  };

  const handleClose = () => {
    setOffset(0);
    setRevealed(false);
  };

  const actionPanelWidth = Math.min(actions.length * 64, MAX_SLIDE);

  return (
    <div
      className={`relative overflow-hidden rounded-xl ${className}`}
      data-testid={testId}
    >
      <div
        className="absolute right-0 top-0 bottom-0 flex"
        style={{ width: actionPanelWidth }}
      >
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={() => { action.onClick(); handleClose(); }}
            className={`flex flex-col items-center justify-center flex-1 gap-1 text-white text-[10px] font-medium ${action.color} transition-opacity active:opacity-80`}
            data-testid={action.testId}
          >
            <action.icon className="w-4 h-4" />
            {action.label}
          </button>
        ))}
      </div>

      <div
        ref={cardRef}
        className="relative bg-card border border-border/40 rounded-xl transition-transform will-change-transform"
        style={{ transform: `translateX(-${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
        {revealed && (
          <button
            onClick={handleClose}
            className="absolute inset-0 bg-transparent"
            aria-label="Close actions"
          />
        )}
      </div>
    </div>
  );
}
