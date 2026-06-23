// Two-tap confirm arming, shared by every vertical's ActionButton. First tap
// arms; second tap (while armed) runs. Arming auto-expires.
import { useCallback, useRef, useState } from 'react';

export interface ArmedAction {
  armedId: string | null;
  isArmed: (id: string) => boolean;
  arm: (id: string) => void;
  disarm: () => void;
}

export function useArmedAction(timeoutMs = 10000): ArmedAction {
  const [armedId, setArmedId] = useState<string | null>(null);
  const timer = useRef<number>(0);

  const disarm = useCallback(() => {
    window.clearTimeout(timer.current);
    setArmedId(null);
  }, []);

  const arm = useCallback(
    (id: string) => {
      window.clearTimeout(timer.current);
      setArmedId(id);
      timer.current = window.setTimeout(() => setArmedId(null), timeoutMs);
    },
    [timeoutMs],
  );

  const isArmed = useCallback((id: string) => armedId === id, [armedId]);

  return { armedId, isArmed, arm, disarm };
}
