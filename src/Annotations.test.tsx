import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnnotationObject, Background } from './Annotations';
import { newBoard, type Annotation } from './model';

describe('shared display and export primitives', () => {
  it('renders editable text safely, without interpreting markup', () => {
    const annotation: Annotation = { id: 't', type: 'text', text: '<script>hello</script>\nLine 2', points: [{ x: 10, y: 20, pressure: 0.5 }], color: '#173a43', width: 1, opacity: 1 };
    const { container } = render(<svg><AnnotationObject annotation={annotation} /></svg>);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelectorAll('tspan')).toHaveLength(2);
    expect(container.textContent).toContain('<script>');
  });
  it('renders pressure-sensitive smooth ink and patterned paper', () => {
    const board = newBoard('grid'), annotation: Annotation = { id: 'p', type: 'pen', points: [{ x: 10, y: 20, pressure: 0.2 }, { x: 100, y: 120, pressure: 1 }], color: '#0d9488', width: 4, opacity: 0.5 };
    const { container } = render(<svg><Background page={board.pages[0]} /><AnnotationObject annotation={annotation} /></svg>);
    expect(container.querySelector('pattern')).not.toBeNull();
    expect(container.querySelector('path[fill="#0d9488"]')?.getAttribute('d')).toContain('Q');
  });
});
