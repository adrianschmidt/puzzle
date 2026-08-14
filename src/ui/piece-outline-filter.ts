/**
 * Consumers apply the filter with `filter: url(#piece-outline)`. The host `<svg>`
 * is zero-sized and aria-hidden so it takes no layout space and stays out of a11y trees.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const HOST_ATTR = 'data-piece-outline-host';

export function installPieceOutlineFilter(): void {
    if (document.querySelector(`svg[${HOST_ATTR}]`)) {
        return;
    }

    const host = document.createElementNS(SVG_NS, 'svg');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute(HOST_ATTR, '');
    host.style.position = 'absolute';

    const defs = document.createElementNS(SVG_NS, 'defs');
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', 'piece-outline');
    filter.setAttribute('x', '-10%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%');
    filter.setAttribute('height', '120%');

    const morph = document.createElementNS(SVG_NS, 'feMorphology');
    morph.setAttribute('in', 'SourceGraphic');
    morph.setAttribute('operator', 'dilate');
    morph.setAttribute('radius', '1');
    morph.setAttribute('result', 'dilated');
    filter.appendChild(morph);

    const flood = document.createElementNS(SVG_NS, 'feFlood');
    // Set flood-color via the style property, not a presentation attribute (which
    // can't hold a var()), so the picker can recolor live. `#080808` (gray-darker-3)
    // is the fallback if the property is never set.
    flood.style.setProperty(
        'flood-color',
        'var(--piece-outline-color, #080808)',
    );
    flood.setAttribute('result', 'color');
    filter.appendChild(flood);

    const composite = document.createElementNS(SVG_NS, 'feComposite');
    composite.setAttribute('in', 'color');
    composite.setAttribute('in2', 'dilated');
    composite.setAttribute('operator', 'in');
    composite.setAttribute('result', 'outline');
    filter.appendChild(composite);

    const merge = document.createElementNS(SVG_NS, 'feMerge');
    const outlineNode = document.createElementNS(SVG_NS, 'feMergeNode');
    outlineNode.setAttribute('in', 'outline');
    merge.appendChild(outlineNode);
    const sourceNode = document.createElementNS(SVG_NS, 'feMergeNode');
    sourceNode.setAttribute('in', 'SourceGraphic');
    merge.appendChild(sourceNode);
    filter.appendChild(merge);

    defs.appendChild(filter);
    host.appendChild(defs);
    document.body.appendChild(host);
}
