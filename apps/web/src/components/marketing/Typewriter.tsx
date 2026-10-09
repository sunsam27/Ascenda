'use client';

import { useEffect, useState } from 'react';
import shared from './shared.module.css';
import styles from './Typewriter.module.css';

type TypewriterProps = {
  text: string;
  /** Delay between each revealed character, in milliseconds. */
  speed?: number;
};

export default function Typewriter({ text, speed = 50 }: TypewriterProps) {
  const [visible, setVisible] = useState('');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(text);
      return;
    }

    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisible(text.slice(0, index));
      if (index >= text.length) window.clearInterval(timer);
    }, speed);

    return () => window.clearInterval(timer);
  }, [text, speed]);

  return (
    <span className={styles.wrap}>
      <span className={shared.srOnly}>{text}</span>
      <span className={styles.ghost} aria-hidden="true">
        {text}
      </span>
      <span className={styles.text} aria-hidden="true">
        {visible}
      </span>
    </span>
  );
}
