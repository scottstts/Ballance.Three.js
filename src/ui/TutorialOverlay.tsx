import { useEffect, useMemo, useState } from 'react';
import { fetchGameBuffer } from '../engine/assets.ts';
import { useGameStore } from '../game/store.ts';
import { useOgui } from './useOgui.ts';

const TEXT_WIDTH_AT_640 = (0.7330737113952637 - 0.24332548677921295) * 640 - 4;

export default function TutorialOverlay() {
  const chapter = useGameStore((state) => state.tutorialChapter);
  const visible = useGameStore((state) => state.tutorialVisible);
  const ogui = useOgui();
  const [chapters, setChapters] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchGameBuffer('Text/Tutorial2.txt').then((buffer) => {
      if (cancelled) return;
      const text = new TextDecoder('windows-1252').decode(buffer).replaceAll('\r', '');
      setChapters(text.split('*'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const lines = useMemo(() => {
    if (!ogui || chapter === null || !chapters[chapter]) return [];
    const wrapped: string[] = [];
    for (const paragraph of chapters[chapter].split('\n')) {
      if (paragraph === '') {
        wrapped.push('');
        continue;
      }
      let line = '';
      for (const word of paragraph.split(' ')) {
        const candidate = line === '' ? word : `${line} ${word}`;
        if (line !== '' && ogui.text(candidate, 16).w > TEXT_WIDTH_AT_640) {
          wrapped.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      wrapped.push(line);
    }
    while (wrapped.at(-1) === '') wrapped.pop();
    return wrapped;
  }, [chapter, chapters, ogui]);

  if (!visible || chapter === null || !ogui || lines.length === 0) return null;
  return (
    <div className="tutorial-overlay" aria-live="polite">
      <div className="tutorial-back" />
      <div className="tutorial-text">
        {lines.map((line, index) => {
          if (line === '') return <div className="tutorial-blank" key={index} />;
          const image = ogui.text(line, 16, '#ffffff', '#000000');
          return <img key={index} src={image.url} alt={line} draggable={false} />;
        })}
      </div>
    </div>
  );
}
