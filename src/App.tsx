import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { eras, lanes, moments } from './data';
import type { LaneId, Moment, Era } from './data';
import {
  END, FULL_SPAN, INITIAL_CAMERA, NOW, START,
  clampCamera, formatYear, fromWorld, location, makeTicks,
  toWorld, zoomAt, zoomCaption, zoomLevel,
} from './time';
import type { Camera } from './time';

const laneMap = Object.fromEntries(lanes.map(lane => [lane.id, lane])) as Record<LaneId, (typeof lanes)[number]>;
const bookmarks: Array<{ label: string; sub: string; icon: string; year?: number; span?: number }> = [
  { label: '全宇宙', sub: '138億年の旅', icon: '✦' },
  { label: '地球誕生', sub: '約46億年前', icon: '◉', year: -4_540_000_000, span: 2.8 },
  { label: '恐竜の時代', sub: '中生代', icon: '♢', year: -150_000_000, span: 1.5 },
  { label: '人類の登場', sub: '約30万年前', icon: '✣', year: -300_000, span: 1.7 },
  { label: '日本の歴史', sub: '縄文〜現代', icon: '✿', year: -1200, span: 3.2 },
  { label: '江戸〜現代', sub: '近世・近代', icon: '◈', year: 1800, span: 0.76 },
  { label: '遠い未来', sub: '宇宙の行方', icon: '∞', year: 1e40, span: 6.2 },
];

function SvgIcon({ name, size = 18 }: { name: 'search' | 'plus' | 'minus' | 'close' | 'reset' | 'arrow' | 'layers' | 'info'; size?: number }) {
  const paths: Record<typeof name, React.ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 5 5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    reset: <><path d="M3.5 11a8.5 8.5 0 1 1 2.1 6" /><path d="M3 4v7h7" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function useViewportWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(1024);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export default function App() {
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const [activeLanes, setActiveLanes] = useState<LaneId[]>(lanes.map(lane => lane.id));
  const [selected, setSelected] = useState<Moment | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointerMap = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef(0);
  const viewportWidth = useViewportWidth(viewportRef);
  const zoom = zoomLevel(camera);
  const visibleLanes = lanes.filter(lane => activeLanes.includes(lane.id));
  const stageHeight = 116 + visibleLanes.length * 102;
  const cameraLeft = camera.center - camera.span / 2;
  const cameraRight = camera.center + camera.span / 2;
  const currentX = location(toWorld(NOW), camera);
  const ticks = useMemo(() => makeTicks(camera, viewportWidth), [camera, viewportWidth]);
  const approxText = zoom < 2 ? '幅は経過年数に比例しない非線形の時間軸です' : '拡大・縮小して、出来事の詳しさを切り替えられます';

  const visibleMoments = useMemo(() => {
    const near = moments.filter(item => {
      const x = toWorld(item.year);
      return activeLanes.includes(item.lane) &&
        x >= camera.center - camera.span * 0.55 &&
        x <= camera.center + camera.span * 0.55 &&
        (item.minZoom <= zoom + 0.65 || selected?.id === item.id);
    });
    near.sort((a, b) =>
      (a.id === selected?.id ? -1 : b.id === selected?.id ? 1 : 0) ||
      a.minZoom - b.minZoom ||
      a.year - b.year
    );
    const positions = new Map<LaneId, number[]>();
    const output: Moment[] = [];
    for (const item of near) {
      const px = location(toWorld(item.year), camera) * viewportWidth / 100;
      if (px < -30 || px > viewportWidth + 30) continue;
      const occupied = positions.get(item.lane) ?? [];
      const gap = viewportWidth < 600 ? 105 : 138;
      if (selected?.id !== item.id && occupied.some(other => Math.abs(other - px) < gap)) continue;
      occupied.push(px);
      positions.set(item.lane, occupied);
      output.push(item);
    }
    return output;
  }, [camera, activeLanes, zoom, viewportWidth, selected]);

  const visibleEras = useMemo(() => eras.filter(era => {
    return activeLanes.includes(era.lane) &&
      era.minZoom <= zoom + 0.5 &&
      toWorld(era.end) > cameraLeft &&
      toWorld(era.start) < cameraRight;
  }), [activeLanes, zoom, cameraLeft, cameraRight]);

  const searchResults = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ja-JP');
    if (!term) return [];
    return moments.filter(item =>
      item.title.toLocaleLowerCase('ja-JP').includes(term) ||
      item.summary.toLocaleLowerCase('ja-JP').includes(term) ||
      formatYear(item.year).includes(term)
    ).slice(0, 7);
  }, [search]);

  function jumpTo(year?: number, span?: number) {
    setSelected(null);
    if (year === undefined || span === undefined) {
      setCamera(INITIAL_CAMERA);
      return;
    }
    setCamera(clampCamera({ center: toWorld(year), span }));
  }

  function focusMoment(item: Moment) {
    setSearch('');
    setSearchOpen(false);
    setSelected(item);
    setCamera(clampCamera({
      center: toWorld(item.year),
      span: item.year >= 1e15 ? 1.35 : item.year < -1e6 ? 0.85 : 0.62,
    }));
  }

  function focusEra(era: Era) {
    const first = toWorld(era.start);
    const last = toWorld(era.end);
    setCamera(clampCamera({ center: (first + last) / 2, span: Math.max(0.1, (last - first) * 1.85) }));
  }

  function toggleLane(lane: LaneId) {
    setActiveLanes(current =>
      current.includes(lane) ?
        (current.length === 1 ? current : current.filter(id => id !== lane)) :
        lanes.filter(item => current.includes(item.id) || item.id === lane).map(item => item.id)
    );
  }

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const relativeX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const multiplier = Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * 0.006);
      setCamera(current => zoomAt(current, multiplier, relativeX));
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelected(null);
      setSearchOpen(false);
      setShowFilters(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerMap.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerMap.current.size === 2) {
      const [a, b] = Array.from(pointerMap.current.values());
      pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const previous = pointerMap.current.get(event.pointerId);
    if (!previous) return;
    pointerMap.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(pointerMap.current.values());
    if (points.length >= 2) {
      const [a, b] = points;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance.current > 0 && distance > 0) {
        const rect = event.currentTarget.getBoundingClientRect();
        const midpoint = Math.max(0, Math.min(1, ((a.x + b.x) / 2 - rect.left) / rect.width));
        const factor = pinchDistance.current / distance;
        setCamera(current => zoomAt(current, factor, midpoint));
      }
      pinchDistance.current = distance;
      return;
    }
    const diff = event.clientX - previous.x;
    if (Math.abs(diff) > 0) {
      setCamera(current => clampCamera({ center: current.center - diff / viewportWidth * current.span, span: current.span }));
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointerMap.current.delete(event.pointerId);
    pinchDistance.current = 0;
    if (pointerMap.current.size === 2) {
      const [a, b] = Array.from(pointerMap.current.values());
      pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const firstLabel = formatYear(fromWorld(Math.max(cameraLeft, toWorld(-13_800_000_000))));
  const lastLabel = formatYear(fromWorld(Math.min(cameraRight, toWorld(1e100))));

  return (
    <div className="app">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="./" aria-label="Chrono トップ">
          <span className="brand-mark"><span className="brand-hand" /></span>
          <span className="brand-name">chrono<span className="brand-dot">.</span></span>
        </a>
        <div className="topbar-right">
          <span className="topbar-kicker"><span className="online-dot" /> AN INTERACTIVE HISTORY OF EVERYTHING</span>
          <a className="github-link" href="https://github.com/mky1729/chrono" target="_blank" rel="noreferrer" title="GitHub リポジトリ">GitHub <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <main className="content">
        <section className="intro">
          <div className="intro-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> A JOURNEY THROUGH TIME</p>
            <h1>宇宙の始まりから、<br /><em>時間の果てまで。</em></h1>
            <p className="lead">138億年前の宇宙誕生から、地球、生命、人類、そして私たちの現在へ。<br className="desktop-break" />時を拡大して、歴史のつながりを見つけよう。</p>
          </div>
          <div className="intro-side" aria-hidden="true">
            <div className="orbit orbit-large" />
            <div className="orbit orbit-small" />
            <div className="planet-glow" />
            <div className="planet" />
            <div className="orbit-star">✦</div>
          </div>
        </section>

        <section className="explorer" aria-label="インタラクティブな年表">
          <div className="explorer-header">
            <div className="explorer-heading">
              <span className="section-number">01 / EXPLORE</span>
              <h2>時代を探検する</h2>
              <p>年代を選ぶか、年表をドラッグしてみてください。</p>
            </div>
            <div className="search-wrap">
              <SvgIcon name="search" size={18} />
              <input
                type="search"
                aria-label="出来事を検索"
                placeholder="歴史の出来事を検索..."
                value={search}
                onFocus={() => setSearchOpen(true)}
                onChange={event => { setSearch(event.target.value); setSearchOpen(true); }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && searchResults[0]) focusMoment(searchResults[0]);
                }}
              />
              {search && <button className="clear-search" aria-label="検索を消去" onClick={() => setSearch('')}><SvgIcon name="close" size={15} /></button>}
              {searchOpen && search.trim() && (
                <div className="search-results" role="listbox">
                  {searchResults.length ? searchResults.map(item => (
                    <button key={item.id} className="search-result" onClick={() => focusMoment(item)}>
                      <span className="result-symbol" style={{ color: laneMap[item.lane].color }}>{item.icon}</span>
                      <span className="result-copy"><strong>{item.title}</strong><small>{formatYear(item.year)}</small></span>
                      <SvgIcon name="arrow" size={15} />
                    </button>
                  )) : <p className="no-results">見つかりませんでした。別の言葉で検索してみてください。</p>}
                </div>
              )}
            </div>
          </div>

          <div className="bookmark-strip" aria-label="時代へのショートカット">
            {bookmarks.map((bookmark, index) => (
              <button
                key={bookmark.label}
                className={'bookmark ' + (index === 0 && zoom < 0.1 ? 'bookmark-active' : '')}
                onClick={() => jumpTo(bookmark.year, bookmark.span)}
              >
                <span className="bookmark-icon">{bookmark.icon}</span>
                <span><strong>{bookmark.label}</strong><small>{bookmark.sub}</small></span>
              </button>
            ))}
          </div>

          <div className="timeline-shell">
            <div className="timeline-toolbar">
              <div className="toolbar-left">
                <span className="view-status"><span className="status-pulse" /> {zoomCaption(camera)}</span>
                <span className="toolbar-separator" />
                <span className="timescale-label">ZOOM {zoom.toFixed(1)}×</span>
              </div>
              <div className="toolbar-actions">
                <button className={'tool-button filter-button ' + (showFilters ? 'tool-active' : '')} onClick={() => setShowFilters(x => !x)} aria-expanded={showFilters} title="レーンの表示を選択">
                  <SvgIcon name="layers" size={17} /><span>テーマ</span>
                </button>
                <span className="toolbar-separator" />
                <button className="tool-button icon-button" aria-label="縮小" title="縮小" onClick={() => setCamera(current => zoomAt(current, 1.65, 0.5))}><SvgIcon name="minus" /></button>
                <button className="tool-button icon-button" aria-label="拡大" title="拡大" onClick={() => setCamera(current => zoomAt(current, 0.60, 0.5))}><SvgIcon name="plus" /></button>
                <button className="tool-button icon-button" aria-label="全体を表示" title="全体を表示" onClick={() => jumpTo()}><SvgIcon name="reset" /></button>
              </div>
              {showFilters && (
                <div className="filter-popover">
                  <strong>表示するテーマ</strong>
                  <p>見たいテーマを選んでください</p>
                  {lanes.map(lane => (
                    <label key={lane.id} className="filter-option">
                      <input type="checkbox" checked={activeLanes.includes(lane.id)} onChange={() => toggleLane(lane.id)} disabled={activeLanes.length === 1 && activeLanes.includes(lane.id)} />
                      <span className="filter-dot" style={{ background: lane.color }} />
                      <span>{lane.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="timeline-viewport" ref={viewportRef}
              style={{ height: stageHeight }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onLostPointerCapture={handlePointerUp}
              role="region"
              aria-label="左右ドラッグまたはホイールで移動・拡大できる時間軸"
            >
              <div className="time-field" aria-hidden="true" />
              <div className="timeline-guide-label">PAST <span>←</span></div>
              <div className="timeline-future-label">FUTURE →</div>

              {ticks.map((tick, index) => (
                <div key={index} className="time-tick" style={{ left: location(tick.world, camera) + '%' }}>
                  <span className="tick-label">{tick.label}</span>
                  <span className="tick-stem" />
                </div>
              ))}

              {currentX >= -2 && currentX <= 102 && (
                <div className="present-line" style={{ left: currentX + '%' }}>
                  <span className="present-tag">NOW · 2026</span>
                </div>
              )}

              {visibleLanes.map((lane, laneIndex) => {
                const y = 100 + laneIndex * 102;
                const relevantEras = visibleEras.filter(era => era.lane === lane.id);
                return (
                  <div key={lane.id} className="timeline-lane" style={{ top: y, '--tone': lane.color } as CSSProperties}>
                    <div className="lane-heading"><span className="lane-symbol">{lane.icon}</span><span><strong>{lane.label}</strong><small>{lane.english}</small></span></div>
                    <div className="lane-rule" />
                    {relevantEras.map(era => {
                      const x1 = Math.max(-10, location(toWorld(era.start), camera));
                      const x2 = Math.min(110, location(toWorld(era.end), camera));
                      const width = x2 - x1;
                      if (width <= 0) return null;
                      return (
                        <button key={era.id} className="era-band" style={{ left: x1 + '%', width: width + '%' }} title={era.title + '（クリックして拡大）'} onClick={() => focusEra(era)}>
                          {width * viewportWidth / 100 > 56 && <span>{era.title}</span>}
                        </button>
                      );
                    })}
                    {visibleMoments.filter(item => item.lane === lane.id).map(item => (
                      <button key={item.id}
                        className={'moment ' + (selected?.id === item.id ? 'moment-selected' : '') + (item.kind === 'forecast' ? ' moment-forecast' : '')}
                        style={{ left: location(toWorld(item.year), camera) + '%' }}
                        onClick={() => setSelected(item)}
                        title={item.title + '：' + formatYear(item.year)}
                      >
                        <span className="moment-stem" />
                        <span className="moment-dot"><span>{item.icon}</span></span>
                        <span className="moment-copy"><strong>{item.title}</strong><small>{formatYear(item.year)}</small></span>
                      </button>
                    ))}
                  </div>
                );
              })}
              <div className="viewport-drag-hint" aria-hidden="true">↔ DRAG TO EXPLORE</div>
            </div>

            <div className="timeline-bottom">
              <div className="range-readout">
                <span className="readout-dot" />
                <span>{firstLabel}</span><span className="range-dash">—</span><span>{lastLabel}</span>
              </div>
              <div className="timeline-hint"><span className="hint-arrow">↔</span> ドラッグで移動 <span className="hint-dot">·</span> スクロールで拡大縮小</div>
            </div>

            {selected && (
              <aside className="event-panel" aria-label="出来事の詳細">
                <div className="event-panel-top">
                  <span className="detail-eyebrow">EVENT DETAIL</span>
                  <button className="panel-close" onClick={() => setSelected(null)} aria-label="詳細を閉じる"><SvgIcon name="close" size={19} /></button>
                </div>
                <div className="event-illustration" style={{ '--tone': laneMap[selected.lane].color } as CSSProperties}>
                  <div className="event-orbit one" /><div className="event-orbit two" />
                  <span>{selected.icon}</span>
                </div>
                <span className="event-category" style={{ color: laneMap[selected.lane].color }}>● {laneMap[selected.lane].label} {selected.kind === 'forecast' ? ' / 未来予測' : ''}</span>
                <h3>{selected.title}</h3>
                <p className="event-year">{formatYear(selected.year)}</p>
                <div className="panel-divider" />
                <p className="event-summary">{selected.summary}</p>
                {selected.kind === 'forecast' && <div className="forecast-note"><SvgIcon name="info" size={17} /><span>将来の予測・仮説です。確定した出来事ではありません。</span></div>}
                <button className="focus-button" onClick={() => focusMoment(selected)}>この年代を中心に表示 <SvgIcon name="arrow" size={17} /></button>
                <p className="detail-footnote">年代は概数です。学説や時代区分によって幅があります。</p>
              </aside>
            )}
          </div>

          <div className="explorer-footer">
            <div className="legend" aria-label="テーマ別の色">
              {lanes.map(lane => (
                <button key={lane.id} className={'legend-item ' + (!activeLanes.includes(lane.id) ? 'legend-muted' : '')} onClick={() => toggleLane(lane.id)} title={lane.label + 'の表示を切り替え'}>
                  <span style={{ backgroundColor: lane.color }} />{lane.label}
                </button>
              ))}
            </div>
            <p className="nonlinear-note"><SvgIcon name="info" size={15} /> {approxText}</p>
          </div>

          <div className="overview">
            <div className="overview-label"><span>YOU ARE HERE</span><strong>時間の全体図</strong></div>
            <button className="overview-track" aria-label="時間の全体図から位置を選択" title="クリックして時間の位置を移動"
              onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                setCamera(current => clampCamera({ ...current, center: START + fraction * FULL_SPAN }));
              }}>
              <span className="overview-current" style={{ left: ((toWorld(NOW) - START) / FULL_SPAN * 100) + '%' }} />
              <span className="overview-window" style={{
                left: Math.max(0, (cameraLeft - START) / FULL_SPAN * 100) + '%',
                width: Math.min(100, camera.span / FULL_SPAN * 100) + '%',
              }} />
            </button>
            <div className="overview-endpoints"><span>宇宙の誕生</span><span>遠い未来の仮説</span></div>
          </div>
        </section>

        <section className="footer-section">
          <div><span className="footer-ornament">✳</span><p>時をたどると、<br />すべてがつながって見えてくる。</p></div>
          <span className="footer-signature">CHRONO <span>·</span> AN OPEN TIMELINE PROJECT</span>
        </section>
      </main>
    </div>
  );
}
