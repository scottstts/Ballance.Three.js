import { useEffect, useState } from 'react';
import { loadOgui, type Ogui } from './ogui.ts';

/** load the original-UI asset toolkit once, shared by menus and HUD */
export function useOgui(): Ogui | null {
  const [ogui, setOgui] = useState<Ogui | null>(null);
  useEffect(() => {
    let on = true;
    void loadOgui().then((o) => {
      if (on) setOgui(o);
    });
    return () => {
      on = false;
    };
  }, []);
  return ogui;
}
