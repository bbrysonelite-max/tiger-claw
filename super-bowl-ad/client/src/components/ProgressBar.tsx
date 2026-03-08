// THUNDERSTRUCK Progress Bar — electric orange
import { useEffect, useState } from "react";

export default function ProgressBar() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    function onScroll() {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(docHeight > 0 ? (scrollTop / docHeight) * 100 : 0);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="fixed top-0 left-0 z-50 h-[2px]" style={{ width: `${progress}%`, background: "linear-gradient(90deg, oklch(0.75 0.18 55), oklch(0.88 0.16 90))", boxShadow: "0 0 8px oklch(0.75 0.18 55 / 0.5)", transition: "width 50ms linear" }} />
  );
}
