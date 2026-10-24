// The window a connection talks to: an iframe or popup glottis creates, or a
// frame or window the caller already has.

import { assertExists, popup } from 'belter';
import { isWindow } from 'cross-domain-utils';

import { TARGET_TYPE } from './constants';

type Style = string | Readonly<Record<string, string | number>>;

export type FrameAttributes = {
    readonly style ?: Style,
    readonly [name : string] : string | number | boolean | undefined | Style,
};

export type IframeTarget = {
    readonly type : typeof TARGET_TYPE.IFRAME,
    // Where the frame goes; without one, it is hidden.
    readonly container ?: string | HTMLElement,
    // Any iframe attribute: class, title, allow, sandbox, and style as an
    // object or a CSS string.
    readonly attributes ?: FrameAttributes,
};

export type PopupTarget = {
    readonly type : typeof TARGET_TYPE.POPUP,
    readonly width ?: number,
    readonly height ?: number,
};

export type CreateTarget = IframeTarget | PopupTarget;

export type ExistingTarget = Window | HTMLIFrameElement;

export type OpenedTarget = {
    readonly win : Window,
    readonly frame : HTMLIFrameElement | undefined,
    // Whether glottis made it, and so removes it when the connection ends.
    readonly owned : boolean,
    readonly remove : () => void,
};

const HIDDEN_STYLE : Readonly<Record<string, string>> = {
    position:      'absolute',
    width:         '0',
    height:        '0',
    border:        '0',
    left:          '-9999px',
    top:           '-9999px',
    visibility:    'hidden',
    pointerEvents: 'none'
};

// Numbers in a style object mean pixels, except for these, as in React.
const UNITLESS = new Set([ `zIndex`, `opacity`, `flex`, `flexGrow`, `flexShrink`, `order`, `lineHeight`, `fontWeight`, `zoom` ]);

const toKebab = (name : string) : string => name.replaceAll(/[A-Z]/gu, letter => `-${ letter.toLowerCase() }`);

type ApplyStyleOptions = { readonly frame : HTMLIFrameElement, readonly style : Style };

const applyStyle = ({ frame, style } : ApplyStyleOptions) : void => {
    if (typeof style === 'string') {
        frame.style.cssText = style;

        return;
    }

    for (const [ key, value ] of Object.entries(style)) {
        frame.style.setProperty(toKebab(key), typeof value === 'number' && value !== 0 && !UNITLESS.has(key)
            ? `${ value }px`
            : String(value));
    }
};

const resolveContainer = (container : string | HTMLElement) : HTMLElement => {
    if (typeof container !== 'string') {
        return container;
    }

    const element = document.querySelector<HTMLElement>(container);

    if (!element) {
        throw new Error(`No element matches container "${ container }"`);
    }

    return element;
};

type CreateIframeOptions = {
    readonly url : string,
    readonly target : IframeTarget | undefined,
};

const createIframe = ({ url, target } : CreateIframeOptions) : OpenedTarget => {
    const frame = document.createElement('iframe');
    const { style, ...attributes } = target?.attributes ?? {};

    type AttributeEntry = [ string, string | number | boolean | undefined ];

    for (const [ key, value ] of Object.entries(attributes) as ReadonlyArray<AttributeEntry>) {
        if (value !== undefined && value !== false) {
            frame.setAttribute(key, value === true
                ? ''
                : String(value));
        }
    }

    if (target?.container) {
        if (style !== undefined) {
            applyStyle({ frame, style });
        }

        resolveContainer(target.container).append(frame);
    } else {
        applyStyle({ frame, style: { ...HIDDEN_STYLE } });
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('tabindex', '-1');
        document.body.append(frame);
    }

    frame.src = url;

    const win = assertExists(frame.contentWindow, 'iframe window');

    return { win, frame, owned: true, remove: () => frame.remove() };
};

// A cross-origin window can not be inspected, so it is recognised as a
// window before anything reads its properties.
export const isExistingTarget = (target : unknown) : target is ExistingTarget =>
    target instanceof HTMLIFrameElement || isWindow(target);

type OpenTargetOptions = {
    readonly url : string | undefined,
    readonly target : CreateTarget | ExistingTarget | undefined,
};

// Synchronous on purpose: a popup has to open inside the caller's click.
export const openTarget = ({ url, target } : OpenTargetOptions) : OpenedTarget => {
    if (isExistingTarget(target)) {
        if (url !== undefined) {
            throw new TypeError(`Pass either \`url\` (glottis opens it) or an existing frame or window as \`target\`, not both`);
        }

        if (target instanceof HTMLIFrameElement) {
            const win = target.contentWindow;

            if (!win) {
                throw new Error('The iframe passed as `target` is not in the page');
            }

            return { win, frame: target, owned: false, remove: () => undefined };
        }

        return { win: target, frame: undefined, owned: false, remove: () => undefined };
    }

    if (url === undefined) {
        throw new TypeError('connect() needs a `url` to open, or an existing frame or window as `target`');
    }

    if (target?.type === TARGET_TYPE.POPUP) {
        const win = popup(url, { width: target.width, height: target.height, closeOnUnload: false });

        return { win, frame: undefined, owned: true, remove: () => win.close() };
    }

    return createIframe({ url, target });
};
