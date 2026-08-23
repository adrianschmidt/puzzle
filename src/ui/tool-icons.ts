const SVG_NS = 'http://www.w3.org/2000/svg';

function makeSvg(extraAttrs?: Record<string, string>): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const attrs: Record<string, string> = {
        width: '20',
        height: '20',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        ...extraAttrs,
    };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    return svg;
}

function appendChild(
    svg: SVGSVGElement,
    tag: string,
    attrs: Record<string, string>,
): void {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
}

export function createSelectToolIcon(): SVGSVGElement {
    const svg = makeSvg();
    appendChild(svg, 'path', {
        d: 'M7 3C4.239 3 2 5.216 2 8c0 2.784 2.239 5 5 5h10c2.761 0 5-2.216 5-5s-2.239-5-5-5H7z',
    });
    appendChild(svg, 'path', { d: 'M2 8v5c0 2.784 2.239 5 5 5' });
    appendChild(svg, 'line', { x1: '7', y1: '18', x2: '7', y2: '22' });
    appendChild(svg, 'line', { x1: '5', y1: '22', x2: '9', y2: '22' });
    return svg;
}

export function createMarqueeToolIcon(): SVGSVGElement {
    const svg = makeSvg({ 'stroke-dasharray': '4 3' });
    appendChild(svg, 'rect', { x: '3', y: '3', width: '18', height: '18', rx: '1.5' });
    return svg;
}
