import { useEffect, useState } from "react";

export function useCountUp(target: number, duration: number, trigger: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!trigger) return;
    let start = 0;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        setValue(target);
      }
    }

    requestAnimationFrame(step);
  }, [target, duration, trigger]);

  return value;
}
