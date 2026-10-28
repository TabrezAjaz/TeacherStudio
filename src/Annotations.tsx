import { memo } from 'react';
import { getStroke } from 'perfect-freehand';
import { arrowHead, bounds } from './geometry';
import type { Annotation, Page } from './model';

export const AnnotationObject = memo(function AnnotationObject({ annotation: a }: { annotation: Annotation }) {
  const first = a.points[0], last = a.points[a.points.length - 1], b = bounds(a);
  const common = { stroke: a.color, strokeWidth: a.width, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let content;
  switch (a.type) {
    case 'pen': {
      const stroke = getStroke(a.points.map(p => [p.x, p.y, p.pressure]), { size: a.width * 1.8, thinning: 0.5, smoothing: 0.5, streamline: 0.35, simulatePressure: false });
      if (!stroke.length) { content = null; break; }
      const path = stroke.map(([x, y], i) => {
        const [nx, ny] = stroke[(i + 1) % stroke.length];
        return `${i ? '' : `M ${x} ${y} Q`} ${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
      }).join(' ') + ' Z';
      content = <path d={path} fill={a.color} />;
      break;
    }
    case 'highlighter':
      content = a.points.length === 1
        ? <circle cx={first.x} cy={first.y} r={a.width / 2} fill={a.color} />
        : <g {...common}>{a.points.slice(1).map((point, i) => <line key={i} x1={a.points[i].x} y1={a.points[i].y} x2={point.x} y2={point.y}
          strokeWidth={a.width} />)}</g>;
      break;
    case 'line':
    case 'arrow':
      content = <g {...common}><line x1={first.x} y1={first.y} x2={last.x} y2={last.y} />{a.type === 'arrow' && <polyline points={arrowHead(a)} />}</g>;
      break;
    case 'rectangle': content = <rect {...common} x={b.x} y={b.y} width={b.width} height={b.height} />; break;
    case 'ellipse': content = <ellipse {...common} cx={b.x + b.width / 2} cy={b.y + b.height / 2} rx={b.width / 2} ry={b.height / 2} />; break;
    case 'text': content = <text x={first.x} y={first.y} fill={a.color} fontFamily="Arial, sans-serif" fontSize={a.fontSize ?? 24} dominantBaseline="text-before-edge" xmlSpace="preserve">
      {(a.text ?? '').split('\n').map((line, i) => <tspan key={i} x={first.x} dy={i ? '1.3em' : '0'}>{line || ' '}</tspan>)}
    </text>;
  }
  return <g opacity={a.opacity}>{content}</g>;
});

export function Background({ page, id = 'paper' }: { page: Page; id?: string }) {
  const dark = page.background === '#17212b';
  return <g>
    <rect width={page.width} height={page.height} fill={page.background} />
    {page.pattern !== 'plain' && <>
      <defs><pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse">
        {page.pattern === 'dots'
          ? <circle cx="12" cy="12" r="1" fill={dark ? '#52616d' : '#c7d7dd'} />
          : <path d="M 24 0 L 0 0 0 24" fill="none" stroke={dark ? '#394956' : '#dfe9ed'} strokeWidth="1" />}
      </pattern></defs>
      <rect width={page.width} height={page.height} fill={`url(#${id})`} />
    </>}
  </g>;
}
