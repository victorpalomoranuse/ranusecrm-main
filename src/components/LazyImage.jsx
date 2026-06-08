import { useState } from 'react';
import './LazyImage.css';

export function LazyImage({ src, alt, className = '' }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`lazy-wrap ${loaded ? 'lazy-wrap--loaded' : ''} ${className}`}>
      <div className="lazy-skeleton" />
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="lazy-img"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
