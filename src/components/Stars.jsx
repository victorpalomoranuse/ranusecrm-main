import { useEffect, useRef } from 'react';

export function Stars({ count = 160, shooting = false, style = {} }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;
    let t = 0;

    // Stars
    const stars = [];
    // Shooting stars pool
    const shooters = [];

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    const initStars = () => {
      stars.length = 0;
      for (let i = 0; i < count; i++) {
        stars.push({
          x:     Math.random() * canvas.width,
          y:     Math.random() * canvas.height,
          r:     Math.random() * 1.1 + 0.2,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.005 + 0.002,
        });
      }
    };

    const spawnShooter = () => {
      // Start from top area, random x, diagonal direction
      const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.4; // ~45° ± a bit
      shooters.push({
        x:       Math.random() * canvas.width * 0.7,
        y:       Math.random() * canvas.height * 0.3,
        vx:      Math.cos(angle) * (6 + Math.random() * 5),
        vy:      Math.sin(angle) * (6 + Math.random() * 5),
        len:     80 + Math.random() * 80,
        alpha:   1,
        fade:    0.018 + Math.random() * 0.012,
      });
    };

    // Schedule shooting stars randomly
    let nextShoot = 500 + Math.random() * 700;
    let lastTime = null;

    const draw = (ts) => {
      if (!lastTime) lastTime = ts;
      const dt = ts - lastTime;
      lastTime = ts;
      t += dt;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw stars
      for (const s of stars) {
        const a = 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
        ctx.fill();
      }

      // Shooting stars
      if (shooting) {
        nextShoot -= dt;
        if (nextShoot <= 0) {
          spawnShooter();
          nextShoot = 600 + Math.random() * 900;
        }

        for (let i = shooters.length - 1; i >= 0; i--) {
          const s = shooters[i];

          // Trail gradient
          const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.vx / s.fade * 0.15, s.y - s.vy / s.fade * 0.15);
          grad.addColorStop(0, `rgba(255,255,255,${s.alpha.toFixed(2)})`);
          grad.addColorStop(1, 'rgba(255,255,255,0)');

          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          const angle = Math.atan2(s.vy, s.vx);
          ctx.lineTo(s.x - Math.cos(angle) * s.len * s.alpha, s.y - Math.sin(angle) * s.len * s.alpha);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Bright head dot
          ctx.beginPath();
          ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${s.alpha.toFixed(2)})`;
          ctx.fill();

          s.x += s.vx;
          s.y += s.vy;
          s.alpha -= s.fade;

          if (s.alpha <= 0) shooters.splice(i, 1);
        }
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    initStars();
    raf = requestAnimationFrame(draw);

    const ro = new ResizeObserver(() => { resize(); initStars(); });
    ro.observe(canvas);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [count, shooting]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        ...style,
      }}
    />
  );
}
