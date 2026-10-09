'use client';

import { useEffect, useState } from 'react';
import shared from './shared.module.css';
import styles from './Typewriter.module.css';

type TypewriterProps = {
  text: string;
  /** Delay between each revealed character while typing, in milliseconds. */
  speed?: number;
};

/** Delay between each removed character while clearing, in milliseconds. */
const DELETE_SPEED = 30;
/** How long the full sentence stays on screen before clearing, in milliseconds. */
const HOLD_TIME = 1600;
/** Pause before typing starts again after a full clear, in milliseconds. */
const RESTART_DELAY = 400;

type Phase = 'typing' | 'deleting';

export default function Typewriter({ text, speed = 50 }: TypewriterProps) {
  const [visible, setVisible] = useState('');
  const [phase, setPhase] = useState<Phase>('typing');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(text);
      return;
    }

    let timer: number;

    if (phase === 'typing') {
      timer =
        visible.length < text.length
          ? window.setTimeout(
              () => setVisible(text.slice(0, visible.length + 1)),
              speed,
            )
          : window.setTimeout(() => setPhase('deleting'), HOLD_TIME);
    } else {
      timer =
        visible.length > 0
          ? window.setTimeout(
              () => setVisible(text.slice(0, visible.length - 1)),
              DELETE_SPEED,
            )
          : window.setTimeout(() => setPhase('typing'), RESTART_DELAY);
    }

    return () => window.clearTimeout(timer);
  }, [visible, phase, text, speed]);

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
