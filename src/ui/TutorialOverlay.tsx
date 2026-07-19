import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchGameBuffer } from '../engine/assets.ts';
import { TUTORIAL_SOURCE } from '../game/tutorial.ts';
import { useGameStore } from '../game/store.ts';
import { useOgui } from './useOgui.ts';

const TEXT_WIDTH_AT_640 = (0.7330737113952637 - 0.24332548677921295) * 640 - 4;
const SOURCE_WIDTH = 640;
const SOURCE_HEIGHT = 480;
const FONT_OPTIONS = {
  scaleX: 0.4,
  scaleY: 0.5,
  spaceX: -1.3,
  screenWidth: SOURCE_WIDTH,
  screenHeight: SOURCE_HEIGHT,
} as const;

type FadePhase = 'in' | 'out';

export default function TutorialOverlay() {
  const chapter = useGameStore((state) => state.tutorialChapter);
  const textVisible = useGameStore((state) => state.tutorialVisible);
  const panelVisible = useGameStore((state) => state.tutorialPanelVisible);
  const ogui = useOgui();
  const [chapters, setChapters] = useState<string[]>([]);
  const [textMounted, setTextMounted] = useState(textVisible);
  const [panelMounted, setPanelMounted] = useState(panelVisible);
  const [displayedChapter, setDisplayedChapter] = useState(chapter);
  const [textFade, setTextFade] = useState<FadePhase>('in');
  const [panelFade, setPanelFade] = useState<FadePhase>('in');
  const textClosing = useRef(false);
  const panelClosing = useRef(false);

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

  useEffect(() => {
    let transitionTimer: number | undefined;
    const startTimer = window.setTimeout(() => {
      if (!textVisible) {
        if (textMounted) {
          textClosing.current = true;
          setTextFade('out');
          transitionTimer = window.setTimeout(() => {
            textClosing.current = false;
            setTextMounted(false);
          }, TUTORIAL_SOURCE.textFadeMs);
        }
      } else if (!textMounted) {
        setDisplayedChapter(chapter);
        setTextMounted(true);
        setTextFade('in');
      } else if (textClosing.current) {
        textClosing.current = false;
        setDisplayedChapter(chapter);
        setTextFade('in');
      } else if (chapter !== displayedChapter) {
        setTextFade('out');
        transitionTimer = window.setTimeout(() => {
          setDisplayedChapter(chapter);
          setTextFade('in');
        }, TUTORIAL_SOURCE.textFadeMs);
      }
    }, 0);
    return () => {
      window.clearTimeout(startTimer);
      if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    };
  }, [chapter, displayedChapter, textMounted, textVisible]);

  useEffect(() => {
    let transitionTimer: number | undefined;
    const startTimer = window.setTimeout(() => {
      if (!panelVisible) {
        if (panelMounted) {
          panelClosing.current = true;
          setPanelFade('out');
          transitionTimer = window.setTimeout(() => {
            panelClosing.current = false;
            setPanelMounted(false);
          }, TUTORIAL_SOURCE.textFadeMs);
        }
      } else if (!panelMounted) {
        setPanelMounted(true);
        setPanelFade('in');
      } else if (panelClosing.current) {
        panelClosing.current = false;
        setPanelFade('in');
      }
    }, 0);
    return () => {
      window.clearTimeout(startTimer);
      if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    };
  }, [panelMounted, panelVisible]);

  const lines = useMemo(() => {
    if (!ogui || displayedChapter === null || !chapters[displayedChapter]) return [];
    const wrapped: string[] = [];
    for (const paragraph of chapters[displayedChapter].split('\n')) {
      if (paragraph === '') {
        wrapped.push('');
        continue;
      }
      let line = '';
      for (const word of paragraph.split(' ')) {
        const candidate = line === '' ? word : `${line} ${word}`;
        if (
          line !== '' &&
          ogui.text(candidate, 32, '#ffffff', '#000000', FONT_OPTIONS).w > TEXT_WIDTH_AT_640
        ) {
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
  }, [chapters, displayedChapter, ogui]);

  if ((!textMounted && !panelMounted) || displayedChapter === null || !ogui) return null;
  const laterPanel = chapter !== null && chapter >= 4;
  return (
    <div className="tutorial-overlay" aria-live="polite">
      {panelMounted && (
        <div
          className={`tutorial-back tutorial-fade-${panelFade}${laterPanel ? ' tutorial-back-later' : ''}`}
        />
      )}
      {textMounted && lines.length > 0 && (
        <div className={`tutorial-text tutorial-fade-${textFade}`}>
          {lines.map((line, index) => {
            if (line === '') return <div className="tutorial-blank" key={index} />;
            const image = ogui.text(line, 32, '#ffffff', '#000000', FONT_OPTIONS);
            return (
              <img
                key={index}
                src={image.url}
                alt={line}
                draggable={false}
                style={{
                  width: `${(image.w / SOURCE_WIDTH) * 100}cqw`,
                  height: `${(image.h / SOURCE_HEIGHT) * 100}cqh`,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
