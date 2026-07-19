import { LOADING_SOURCE, loadingBarState } from '../game/loading.ts';

export default function LoadingScreen({ part }: { part: number }) {
  const state = loadingBarState(part);
  const [red, green, blue] = LOADING_SOURCE.colorA;
  return (
    <div className="loading-screen" aria-hidden="true">
      <div
        className="loading-bar"
        style={{
          width: `${state.progress * 100}%`,
          backgroundColor: `rgba(${red * 255}, ${green * 255}, ${blue * 255}, ${state.alpha})`,
        }}
      />
    </div>
  );
}
