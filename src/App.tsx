import GameCanvas from './GameCanvas.tsx';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const level = Math.min(12, Math.max(1, Number(params.get('level') ?? 1)));
  return <GameCanvas level={level} />;
}
