/**
 * Inject the SVG `<filter id="piece-outline">` used by the Outline
 * mode of the Piece outline setting. The filter dilates the source
 * graphic by 1px, recolors that ring with the outline color (the
 * `--piece-outline-color` custom property, defaulting to near-black),
 * then composites the original on top — producing a sharp 1px
 * silhouette around the group `<div>` it's applied to via
 * `filter: url(#piece-outline)`.
 *
 * The filter is hosted in a zero-sized, aria-hidden `<svg>` so it
 * occupies no layout space and is excluded from a11y trees.
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
    // Read the outline color from a CSS custom property so the picker can
    // recolor the outline live (a presentation attribute can't hold a
    // var()). The `#080808` fallback (= gray-darker-3) keeps the outline
    // black if the property is never set.
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
