/**
 * Attribution display for puzzle images.
 *
 * Shows photographer credit as required by the Unsplash API guidelines.
 * Renders as a small, unobtrusive link in the corner of the puzzle area.
 */

import type { ImageAttribution } from '../model/types.js';
import { isSafeHttpUrl } from '../sharing/safe-url.js';

const ATTRIBUTION_CLASS = 'image-attribution';

/**
 * Create an attribution element for the current puzzle image.
 *
 * Displays "Photo by {name} on Unsplash" with appropriate links,
 * following Unsplash API guidelines for attribution.
 */
export function createAttributionElement(
    attribution: ImageAttribution,
): HTMLElement {
    const container = document.createElement('div');
    container.className = ATTRIBUTION_CLASS;

    // Defense-in-depth: the decode path already rejects share links whose
    // attribution URLs aren't http(s), but this sink is reused, so guard the
    // href here too. A non-http(s) URL is dropped (the anchor renders as
    // plain text) rather than smuggling a `javascript:` scheme into the DOM.
    const photographerLink = document.createElement('a');
    if (isSafeHttpUrl(attribution.photographerUrl)) {
        photographerLink.href = attribution.photographerUrl;
    }
    photographerLink.target = '_blank';
    photographerLink.rel = 'noopener noreferrer';
    photographerLink.textContent = attribution.photographerName;

    const unsplashLink = document.createElement('a');
    if (isSafeHttpUrl(attribution.photoUrl)) {
        unsplashLink.href = attribution.photoUrl;
    }
    unsplashLink.target = '_blank';
    unsplashLink.rel = 'noopener noreferrer';
    unsplashLink.textContent = 'Unsplash';

    container.appendChild(document.createTextNode('Photo by '));
    container.appendChild(photographerLink);
    container.appendChild(document.createTextNode(' on '));
    container.appendChild(unsplashLink);

    return container;
}

/**
 * Remove any existing attribution element from the container.
 */
export function removeAttribution(container: HTMLElement): void {
    const existing = container.querySelector(`.${ATTRIBUTION_CLASS}`);

    if (existing) {
        existing.remove();
    }
}

/**
 * Build the inner HTML string for an attribution element.
 *
 * Pure function for easy testing. The actual DOM creation uses
 * `createAttributionElement` which sets proper link attributes.
 */
export function formatAttributionText(attribution: ImageAttribution): string {
    return `Photo by ${attribution.photographerName} on Unsplash`;
}
