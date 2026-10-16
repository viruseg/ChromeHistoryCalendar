'use strict';

/**
 * Dependency-free regression check for the calendar grid and picker invariants.
 *
 *     node tools/check-calendar-grid.mjs
 *     node tools/check-calendar-grid.mjs path/to/other-calendar.js
 *
 * Loads `src/js/calendar.js` — a classic script, not a module — into a `node:vm` context
 * that carries a minimal DOM stub, drives a real `Calendar` through a matrix of months,
 * orientations and mount modes, and asserts the grid invariants on every render it
 * produces. A second matrix then opens both pickers from their own captions, clicks their
 * buttons and presses their arrows. Exits non-zero if any invariant fails or if any
 * harness self-check fails.
 *
 * The DOM stub is described in `class StubElement`; the invariants are in `inspectGrid` and
 * `inspectPickers`. Both are deliberately small so that a passing run is evidence rather
 * than a tautology — the harness proves it can fail before it is allowed to report success
 * (see the canaries in `runMatrix` and `runPickerMatrix`).
 *
 * What the stub cannot see: layout, styles, focus, and anything asynchronous. The `cw___now`
 * mark depends on the wall clock and is therefore never asserted on its own. Fix a real
 * defect in `calendar.js`, never by relaxing an invariant here.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_ARG = process.argv[2] ?? null;
const SOURCE_PATH = SOURCE_ARG === null
    ? resolve(SCRIPT_DIR, '..', 'src', 'js', 'calendar.js')
    : resolve(process.cwd(), SOURCE_ARG);
const SOURCE_LABEL = SOURCE_ARG === null ? 'src/js/calendar.js' : SOURCE_ARG;

/* Synthetic locale: month and weekday names carry no meaning to the assertions beyond
   being stable strings, and ASCII keeps the caption readable in a failure report
   whatever the machine's locale is. */
const MONTH_NAMES = ['m00', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11'];
/** Fixed English month names for the report, so its output does not depend on the host locale. */
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
const WEEKDAYS_SHORT = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'];
const SYNTHETIC_LOCALE = {
    months: { nominative: MONTH_NAMES, genitive: MONTH_NAMES.map(name => `${name}g`) },
    weekdays: { short: WEEKDAYS_SHORT, full: WEEKDAYS_SHORT.map(name => `${name}f`), completeText: 'ok' }
};

/** Years covering a leap February, three plain Februaries and every start weekday. */
const YEARS = [2000, 2010, 2024, 2026, 2027];
const MONTHS = Array.from({ length: 12 }, (_, month) => month);
const ORIENTATIONS = [true, false];
const MODES = ['inline', 'popup'];

/* ------------------------------------------------------------------ selector engine */

/** tag, then any number of `.class`, `#id` or `[attr]` / `[attr="value"]` qualifiers */
const SIMPLE_SELECTOR = /^(?:([a-zA-Z][\w-]*))?((?:[.#][\w-]+|\[[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\]]*))?\])*)$/;
const QUALIFIER = /\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;

/**
 * @param {string} token one compound selector, e.g. `td[data-date]`
 * @returns {{tag: string|null, id: string|null, classes: string[], attributes: [string, string|null][]}}
 */
function parseSimpleSelector(token) {
    const match = SIMPLE_SELECTOR.exec(token);
    if (match === null) {
        throw new Error(`unsupported selector token: ${token}`);
    }

    const spec = {
        tag: match[1] === undefined ? null : match[1].toUpperCase(),
        id: null,
        classes: [],
        attributes: []
    };
    for (const [, className, idName, attribute, doubleQuoted, singleQuoted, bare] of match[2].matchAll(QUALIFIER)) {
        if (className !== undefined) {
            spec.classes.push(className);
        } else if (idName !== undefined) {
            spec.id = idName;
        } else {
            spec.attributes.push([attribute, doubleQuoted ?? singleQuoted ?? bare ?? null]);
        }
    }

    return spec;
}

/**
 * @param {string} selector comma-separated list of descendant chains
 * @returns {{tag: string|null, id: string|null, classes: string[], attributes: [string, string|null][]}[][]}
 *     chains, ancestors first
 */
function parseSelector(selector) {
    return String(selector)
        .split(',')
        .map(part => part.trim())
        .filter(part => part !== '')
        .map(part => part.split(/\s+/).map(parseSimpleSelector));
}

/**
 * @param {StubElement} node
 * @param {{tag: string|null, id: string|null, classes: string[], attributes: [string, string|null][]}} spec
 * @returns {boolean}
 */
function matchesSimple(node, spec) {
    if (spec.tag !== null && node.tagName !== spec.tag) {
        return false;
    }
    if (spec.id !== null && node.getAttribute('id') !== spec.id) {
        return false;
    }
    if (!spec.classes.every(name => node.classList.contains(name))) {
        return false;
    }
    return spec.attributes.every(([name, value]) => node.hasAttribute(name)
        && (value === null || node.getAttribute(name) === value));
}

/**
 * @param {StubElement} node candidate for the last compound selector
 * @param {{tag: string|null, id: string|null, classes: string[]}[]} chain
 * @returns {boolean}
 */
function matchesChain(node, chain) {
    if (!matchesSimple(node, chain[chain.length - 1])) {
        return false;
    }

    let ancestor = node.parent;
    for (let index = chain.length - 2; index >= 0; index--) {
        let matched = false;
        while (ancestor !== null) {
            if (matchesSimple(ancestor, chain[index])) {
                matched = true;
                ancestor = ancestor.parent;
                break;
            }
            ancestor = ancestor.parent;
        }
        if (!matched) {
            return false;
        }
    }

    return true;
}

/* --------------------------------------------------------------------- DOM stub */

/**
 * The slice of the DOM `calendar.js` touches, and nothing else.
 *
 * Implements: element tree (`append`, `appendChild`, `replaceChildren`, `remove`,
 * `children`, `firstElementChild`, `lastElementChild`, `contains`), attributes,
 * `className` / `classList`, `textContent` as a plain string, `style` as a plain object,
 * selector queries (`querySelector`, `querySelectorAll`, `closest`, tag + `.class` + `#id`
 * + descendant + comma selectors), and capturing-free event listeners with bubbling,
 * `stopPropagation` and `closest`-based delegation.
 *
 * Deliberately absent: text nodes, layout (every box is zero-sized), styles, the visual
 * result of any class, focus behaviour, timers, and anything asynchronous. The
 * invariants below are therefore about the markup `calendar.js` builds and the clicks it
 * routes — not about what the stylesheet then paints.
 */
class StubElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.parent = null;
        this.children = [];
        this.style = {};
        this.attributes = new Map();
        this.classList = new StubClassList();
        this.listeners = new Map();
        this.text = '';
    }

    get id() {
        return this.getAttribute('id') ?? '';
    }

    set id(value) {
        this.setAttribute('id', value);
    }

    get className() {
        return [...this.classList].join(' ');
    }

    set className(value) {
        this.classList.replace(value);
    }

    get textContent() {
        return this.text;
    }

    set textContent(value) {
        this.text = value === null || value === undefined ? '' : String(value);
    }

    get firstElementChild() {
        return this.children[0] ?? null;
    }

    get lastElementChild() {
        return this.children[this.children.length - 1] ?? null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    append(...nodes) {
        for (const node of nodes) {
            this.appendChild(node);
        }
    }

    appendChild(node) {
        node.remove();
        node.parent = this;
        this.children.push(node);
        return node;
    }

    replaceChildren(...nodes) {
        for (const child of this.children) {
            child.parent = null;
        }
        this.children = [];
        this.append(...nodes);
    }

    remove() {
        if (this.parent === null) {
            return;
        }
        const index = this.parent.children.indexOf(this);
        if (index !== -1) {
            this.parent.children.splice(index, 1);
        }
        this.parent = null;
    }

    contains(node) {
        for (let current = node; current !== null && current !== undefined; current = current.parent) {
            if (current === this) {
                return true;
            }
        }
        return false;
    }

    /** @returns {StubElement[]} every descendant in document order */
    get descendants() {
        const found = [];
        const stack = [...this.children].reverse();
        while (stack.length > 0) {
            const node = stack.pop();
            found.push(node);
            for (let index = node.children.length - 1; index >= 0; index--) {
                stack.push(node.children[index]);
            }
        }
        return found;
    }

    matchesSelector(selector) {
        return parseSelector(selector).some(chain => matchesChain(this, chain));
    }

    querySelectorAll(selector) {
        const chains = parseSelector(selector);
        return this.descendants.filter(node => chains.some(chain => matchesChain(node, chain)));
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    closest(selector) {
        for (let current = this; current !== null; current = current.parent) {
            if (current.matchesSelector(selector)) {
                return current;
            }
        }
        return null;
    }

    addEventListener(type, handler) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(handler);
    }

    removeEventListener(type, handler) {
        this.listeners.get(type)?.delete(handler);
    }

    /**
     * @param {{type: string, target?: StubElement}} event
     * @returns {boolean} always true; `preventDefault` is recorded but nothing is cancelable
     */
    dispatchEvent(event) {
        const dispatched = {
            type: event.type,
            target: event.target ?? this,
            propagationStopped: false,
            stopPropagation() {
                this.propagationStopped = true;
            },
            preventDefault() {
                this.defaultPrevented = true;
            }
        };

        for (let node = dispatched.target; node !== null && node !== undefined; node = node.parent) {
            const handlers = node.listeners?.get(dispatched.type);
            if (handlers !== undefined) {
                for (const handler of [...handlers]) {
                    handler.call(node, dispatched);
                }
            }
            if (dispatched.propagationStopped) {
                break;
            }
        }

        return true;
    }

    getBoundingClientRect() {
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    }
}

class StubClassList {
    #names = new Set();

    get length() {
        return this.#names.size;
    }

    contains(name) {
        return this.#names.has(name);
    }

    add(...names) {
        for (const name of names) {
            this.#names.add(name);
        }
    }

    remove(...names) {
        for (const name of names) {
            this.#names.delete(name);
        }
    }

    toggle(name, force) {
        const next = force === undefined ? !this.#names.has(name) : Boolean(force);
        if (next) {
            this.#names.add(name);
        } else {
            this.#names.delete(name);
        }
        return next;
    }

    replace(value) {
        this.#names = new Set(String(value).split(/\s+/).filter(part => part !== ''));
    }

    [Symbol.iterator]() {
        return this.#names[Symbol.iterator]();
    }
}

/** The document `calendar.js` sees: a root element tree plus `createElement` and `body`. */
class StubDocument extends StubElement {
    constructor() {
        super('#DOCUMENT');
        const html = new StubElement('HTML');
        html.appendChild(new StubElement('BODY'));
        this.appendChild(html);
    }

    createElement(tagName) {
        return new StubElement(tagName);
    }

    get body() {
        return this.querySelector('body');
    }
}

/* Every computed property reads as `0px`: the popup positioning in `#positionPopup` sums
   a handful of these, and no grid invariant depends on their values. */
const STUB_COMPUTED_STYLE = new Proxy(Object.create(null), {
    get: () => '0px'
});

/**
 * Loads a classic calendar script into a fresh VM context and hands back a way to build
 * instances, each against a brand new document.
 *
 * @param {string} path
 * @param {string} label name used in error messages
 * @returns {{Calendar: Function, freshDocument: () => StubDocument}}
 */
function createRuntime(path, label) {
    const sandbox = {
        console,
        document: new StubDocument(),
        getComputedStyle: () => STUB_COMPUTED_STYLE,
        scrollX: 0,
        scrollY: 0
    };
    createContext(sandbox);
    runInContext(readFileSync(path, 'utf8'), sandbox, { filename: label });

    if (typeof sandbox.Calendar !== 'function') {
        throw new Error(`${label} did not leave a Calendar class on globalThis`);
    }

    return {
        Calendar: sandbox.Calendar,
        freshDocument() {
            /* Resolved from the sandbox global on every use, so swapping it here is enough
               to give the next instance an empty document. */
            sandbox.document = new StubDocument();
            return sandbox.document;
        }
    };
}

/* ------------------------------------------------------------------- the invariants */

/**
 * @typedef {{name: string, ok: boolean, skipped: boolean, detail: string}} CheckResult
 */

/** @param {Array<string|number>} values @param {number} keep @returns {string} */
function preview(values, keep = 8) {
    const shown = values.map(String);
    return shown.length <= keep ? shown.join(' ') : `${shown.slice(0, keep).join(' ')} ...+${shown.length - keep}`;
}

/**
 * Parses `data-date` and insists it names a day `new Date(y, m, d)` actually produces.
 *
 * @param {StubElement} cell
 * @returns {{raw: string|null, ok: boolean, year: number, month: number, day: number, date: Date|null}}
 */
function readCellDate(cell) {
    const raw = cell.getAttribute('data-date');
    if (raw === null || !/^\d+\.\d+\.\d+$/.test(raw)) {
        return { raw, ok: false, year: 0, month: 0, day: 0, date: null };
    }

    const [year, month, day] = raw.split('.').map(Number);
    const date = new Date(year, month, day);
    const ok = date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;

    return { raw, ok, year, month, day, date: ok ? date : null };
}

/**
 * @typedef {{
 *     year: number,
 *     month: number,
 *     weekStartsOnMonday: boolean,
 *     mode: 'inline'|'popup',
 *     locale: object|null,
 *     monthNames: string[],
 *     weekdayNames: string[]
 * }} CaseSpec
 */

/**
 * @param {{document: StubDocument, spec: CaseSpec}} input
 * @returns {CheckResult[]}
 */
function inspectGrid({ document, spec }) {
    const { year, month, weekStartsOnMonday, monthNames, weekdayNames } = spec;

    const results = [];
    const record = (name, ok, detail = '', skipped = false) => {
        results.push({ name, ok, detail, skipped });
    };

    /* The drawn month is read back from the markup rather than from the instance: the
       month its 42 cells mostly belong to. That keeps the expectations independent of
       both the caption and the `cw___day` class, which is what the membership invariant
       below is about. */
    const root = document.querySelector('.cw___calendar');
    const table = root === null ? null : root.querySelector('table');
    if (table === null) {
        record('rootPresent', false, 'the calendar root carries no table');
        return results;
    }
    record('rootPresent', true);

    const dayCount = new Date(year, month + 1, 0).getDate();
    const rows = table.querySelectorAll('tr');

    record('rowCount', rows.length === 8, `${rows.length} rows, expected 8 (arrows, weekdays, 6 weeks)`);

    const arrowCells = rows.length > 0 ? rows[0].querySelectorAll('th') : [];
    const arrowGlyphs = arrowCells.map(cell => cell.querySelector('.cw___buttonJump')?.textContent ?? '');
    record('arrowRow',
        arrowCells.length === 3 && rows[0].querySelectorAll('td').length === 0
            && arrowGlyphs[0] !== '' && arrowGlyphs[2] !== '' && arrowGlyphs[1] === '',
        `arrow row: ${arrowCells.length} th, ${rows[0].querySelectorAll('td').length} td, jumps [${arrowGlyphs.join(' ')}]`);

    /* Weekdays arrive Monday-first in the locale, so a Sunday-first grid is a right
       rotation: `['w7', 'w1' … 'w6']`. */
    const expectedHeader = weekStartsOnMonday
        ? weekdayNames
        : [weekdayNames[6], ...weekdayNames.slice(0, 6)];
    const headerCells = rows.length > 1 ? rows[1].querySelectorAll('td') : [];
    record('weekdayRow',
        headerCells.length === 7
            && headerCells.every((cell, index) => cell.textContent === expectedHeader[index])
            && headerCells.every(cell => !cell.classList.contains('cw___active')),
        `weekday row: ${headerCells.length} cells, [${headerCells.map(cell => cell.textContent).join(' ')}]`);

    const caption = rows.length > 0 ? rows[0].querySelector('.cw___monthChange') : null;
    const wantedCaption = `${monthNames[month]} ${year}`;
    record('caption',
        caption !== null && caption.getAttribute('colspan') === '5' && caption.textContent === wantedCaption,
        `caption reads "${caption === null ? 'nothing' : caption.textContent}", expected "${wantedCaption}"`);

    const dayRows = rows.slice(2);
    const widths = dayRows.map(row => row.querySelectorAll('td').length);
    record('dayRowWidth',
        dayRows.length === 6 && widths.every(width => width === 7)
            && dayRows.every(row => row.querySelectorAll('th').length === 0),
        `day rows: ${dayRows.length}, widths ${widths.join('/')}`);

    /* Cells are tracked with the column they really sit in, not with a flattened index:
       a short row would otherwise shift the whole grid sideways and still look aligned. */
    const positions = dayRows.flatMap(row => row.querySelectorAll('td').map((cell, column) => ({ cell, column })));
    const dayCells = positions.map(position => position.cell);
    record('dayCellCount', dayCells.length === 42, `${dayCells.length} day cells, expected 42`);
    record('dayCellsClickable', dayCells.every(cell => cell.classList.contains('cw___active')),
        `${dayCells.filter(cell => cell.classList.contains('cw___active')).length}/${dayCells.length} carry cw___active`);

    const dates = dayCells.map(readCellDate);
    const brokenDates = dates.map((entry, index) => (entry.ok ? null : dates[index].raw)).filter(raw => raw !== null);
    record('dataDateNormalises', brokenDates.length === 0,
        `${brokenDates.length}/${dayCells.length} do not name a real date: ${preview(brokenDates)}`);
    const sound = dates.every(entry => entry.ok);

    const mislabelled = sound
        ? dates.map((entry, index) => (dayCells[index].textContent === String(entry.day) ? null : entry.raw))
            .filter(raw => raw !== null)
        : [];
    record('cellShowsItsDate', sound && mislabelled.length === 0,
        sound
            ? `${mislabelled.length}/${dayCells.length} render a day number other than their data-date: ${preview(mislabelled)}`
            : 'not checked: the data-date values are unusable');

    const tally = new Map();
    for (const entry of dates) {
        if (entry.ok) {
            const key = `${entry.year}.${entry.month}`;
            tally.set(key, (tally.get(key) ?? 0) + 1);
        }
    }
    let modal = 'none';
    let modalCount = 0;
    for (const [key, count] of [...tally].sort(([left], [right]) => (left < right ? -1 : 1))) {
        if (count > modalCount) {
            modal = key;
            modalCount = count;
        }
    }
    record('drawnMonth', sound && modal === `${year}.${month}`,
        `most cells belong to ${modal} (${modalCount}/${dayCells.length}), expected ${year}.${month}`);

    let consecutive = sound;
    for (let index = 1; index < dates.length && consecutive; index++) {
        const previous = dates[index - 1];
        const next = new Date(previous.year, previous.month, previous.day + 1);
        consecutive = next.getFullYear() === dates[index].year
            && next.getMonth() === dates[index].month
            && next.getDate() === dates[index].day;
    }
    record('cellsAreConsecutive', sound && consecutive,
        sound ? '' : `the ${dayCells.length} cells are not ${dayCells.length} consecutive days`);

    const marked = [];
    const unmarked = [];
    dayCells.forEach((cell, index) => {
        (cell.classList.contains('cw___day') ? marked : unmarked).push(index);
    });

    record('dayClassCount', sound && marked.length === dayCount,
        `${marked.length} cells carry cw___day, ${year}-${String(month + 1).padStart(2, '0')} has ${dayCount} days`);

    const markedDays = marked.map(index => dates[index].day);
    const repeated = [...new Set(markedDays.filter((value, index) => markedDays.indexOf(value) !== index))];
    const missing = Array.from({ length: dayCount }, (_, index) => index + 1)
        .filter(value => !markedDays.includes(value));
    const outside = marked.filter(index => dates[index].year !== year
        || dates[index].month !== month
        || dates[index].day < 1
        || dates[index].day > dayCount);
    record('dayClassRange',
        sound && outside.length === 0 && repeated.length === 0 && missing.length === 0,
        `cw___day outside 1..${dayCount} or outside ${year}-${String(month + 1).padStart(2, '0')}:`
            + ` [${preview(outside.map(index => dates[index].raw))}];`
            + ` days never marked: [${preview(missing)}]; days marked twice: [${preview(repeated)}]`);

    const intruders = unmarked.filter(index => dates[index].year === year && dates[index].month === month);
    record('spillOutsideMonth', sound && intruders.length === 0,
        intruders.length === 0
            ? `${unmarked.length} spill cells all belong to another month`
            : `cells of ${year}.${month} without cw___day: ${preview(intruders.map(index => dates[index].raw))}`);

    const misaligned = sound
        ? positions.map((position, index) => {
            const wantedDay = weekStartsOnMonday ? (position.column + 1) % 7 : position.column;
            return dates[index].date.getDay() === wantedDay ? null : dates[index].raw;
        }).filter(raw => raw !== null)
        : [];
    record('weekdayColumn', sound && misaligned.length === 0,
        !sound
            ? 'not checked: the data-date values are unusable'
            : misaligned.length === 0
                ? `columns line up with ${weekStartsOnMonday ? 'Monday' : 'Sunday'}`
                : `${misaligned.length}/${dayCells.length} sit in the wrong weekday column: ${preview(misaligned)}`);

    return results;
}

/* -------------------------------------------------------------------- the matrix */

/**
 * @param {StubDocument} document
 * @param {Function} Calendar
 * @param {CaseSpec} spec
 * @returns {{calendar: object, rootBefore: StubElement|null}}
 */
function mount(document, Calendar, spec) {
    const host = document.createElement(spec.mode === 'popup' ? 'input' : 'div');
    document.body.appendChild(host);

    const options = {
        target: host,
        view: { year: spec.year, month: spec.month },
        weekStartsOnMonday: spec.weekStartsOnMonday,
        showInfoBar: spec.mode === 'inline'
    };
    if (spec.locale !== null) {
        options.locale = spec.locale;
    }

    return { calendar: new Calendar(options), rootBefore: document.querySelector('.cw___calendar') };
}

/** The cell displaying a given day of the drawn month, found through `data-date`. */
function findCell(document, year, month, day) {
    const wanted = `${year}.${month}.${day}`;
    return document.querySelectorAll('td[data-date]')
        .find(cell => cell.getAttribute('data-date') === wanted) ?? null;
}

/**
 * Drives one calendar through both phases: the render the constructor produces, and the
 * render a day click produces.
 *
 * @param {{Calendar: Function, freshDocument: () => StubDocument}} runtime
 * @param {CaseSpec} spec
 * @returns {{results: Array<{phase: string, checks: CheckResult[]}>, harness: string[]}}
 */
function runCase(runtime, spec) {
    const document = runtime.freshDocument();
    const { calendar, rootBefore } = mount(document, runtime.Calendar, spec);
    const harness = [];

    const results = [{ phase: 'construct', checks: inspectGrid({ document, spec }) }];

    const day = Math.min(15, new Date(spec.year, spec.month + 1, 0).getDate());
    const cell = findCell(document, spec.year, spec.month, day);
    if (cell === null) {
        harness.push(`click: no cell carries data-date ${spec.year}.${spec.month}.${day}`);
        return { results, harness };
    }

    /* Dispatched on the cell, so the click travels the delegated handler `calendar.js`
       binds on the root — the same route a real pointer takes, `#selectDay` included. */
    cell.dispatchEvent({ type: 'click', target: cell });

    const rootAfter = document.querySelector('.cw___calendar');
    const selection = calendar.getDateSelect();
    const markedCells = document.querySelectorAll('td.cw___selected');
    const wanted = `${spec.year}.${spec.month}.${day}`;
    const wantedSelection = {
        year: String(spec.year),
        month: String(spec.month + 1).padStart(2, '0'),
        day: String(day).padStart(2, '0')
    };
    const clicked = rootAfter !== null
        && rootAfter !== rootBefore
        && selection.year === wantedSelection.year
        && selection.month === wantedSelection.month
        && selection.day === wantedSelection.day
        && markedCells.length === 1
        && markedCells[0].getAttribute('data-date') === wanted;

    if (!clicked) {
        harness.push(`click: selection is ${selection.year}.${selection.month}.${selection.day}, `
            + `root rebuilt ${rootAfter !== rootBefore}, ${markedCells.length} cells marked selected`);
    }

    results.push({ phase: 'after click', checks: inspectGrid({ document, spec }) });

    return { results, harness };
}

/**
 * Proves the checker can see the defect it is meant to catch: the same month, the same
 * render path, `setDateSelect` with numbers instead of a click that leaves the drawn month
 * as a string. Only the `#selectDay` path can differ.
 *
 * @param {{Calendar: Function, freshDocument: () => StubDocument}} runtime
 * @param {CaseSpec} spec
 * @returns {string[]} failed check names
 */
function probeNumericPath(runtime, spec) {
    const document = runtime.freshDocument();
    const { calendar } = mount(document, runtime.Calendar, spec);
    calendar.setDateSelect(spec.year, spec.month, 15);
    return inspectGrid({ document, spec }).filter(check => !check.ok && !check.skipped).map(check => check.name);
}

/**
 * Injects the two halves of the T1 defect by hand and insists the checker reports each,
 * so a run that can never fail can never be reported as green.
 *
 * A: a spill cell marked as a day of the month — the wrong count, the wrong range.
 * B: a day of the month left unmarked — the wrong count again, plus an unmarked in-month
 *    cell. Both are compared against the same grid before the injection, so the canary
 *    stays meaningful whether or not the code under test already draws that month wrongly.
 *
 * @param {{Calendar: Function, freshDocument: () => StubDocument}} runtime
 * @param {CaseSpec} spec
 * @returns {{baseline: string[], marks: {name: string, extra: string[], landed: boolean}[], landed: boolean}}
 */
function canary(runtime, spec) {
    const document = runtime.freshDocument();
    mount(document, runtime.Calendar, spec);

    const failingNames = () => inspectGrid({ document, spec }).filter(check => !check.ok).map(check => check.name);
    const baseline = failingNames();

    const cells = document.querySelectorAll('td[data-date]');
    const spill = cells.find(cell => !cell.classList.contains('cw___day'));
    const day = cells.find(cell => cell.classList.contains('cw___day'));
    if (spill === undefined || day === undefined) {
        return { baseline, marks: [], landed: false };
    }

    const inject = (cell, add, name) => {
        const before = cell.classList.contains('cw___day');
        if (add) {
            cell.classList.add('cw___day');
        } else {
            cell.classList.remove('cw___day');
        }
        const landed = cell.classList.contains('cw___day') !== before;
        const extra = failingNames().filter(failing => !baseline.includes(failing));
        if (add) {
            cell.classList.remove('cw___day');
        } else {
            cell.classList.add('cw___day');
        }
        return { name, extra, landed };
    };

    const marks = [inject(spill, true, 'cw___day forced onto a spill cell'), inject(day, false, 'cw___day taken off a day of the month')];

    return { baseline, marks, landed: marks.every(mark => mark.landed) };
}

/** Every month must be reachable in the matrix, or a green run says nothing. */
function assertMatrixCoverage(specs) {
    const starts = new Set(specs.map(spec => new Date(spec.year, spec.month, 1).getDay()));
    const everyYear = [...new Set(specs.map(spec => spec.year))]
        .every(year => MONTHS.every(month => specs.some(spec => spec.year === year && spec.month === month)));

    return {
        ok: starts.size === 7 && everyYear
            && MONTHS.every(month => specs.some(spec => spec.month === month)),
        detail: `month starts cover ${[...starts].sort((left, right) => left - right).map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(' ')}`
            + `; every year carries all 12 months: ${everyYear}`
    };
}

/**
 * @param {{Calendar: Function, freshDocument: () => StubDocument}} runtime
 * @returns {object} the report the printer renders
 */
function runMatrix(runtime) {
    /* The built-in locale's names are the expectation for the cases that run on it, so the
       caption and the weekday rotation stay checkable without parsing Cyrillic. */
    const defaults = runtime.Calendar.DEFAULT_MONTHS ?? { nominative: MONTH_NAMES };
    const defaultWeekdays = runtime.Calendar.DEFAULT_WEEKDAYS ?? { short: WEEKDAYS_SHORT };
    const harnessProblems = [];
    if (defaults.nominative.length !== 12 || defaultWeekdays.short.length !== 7) {
        harnessProblems.push('the class does not expose 12 month and 7 weekday names');
    }

    const synthetic = { locale: SYNTHETIC_LOCALE, monthNames: MONTH_NAMES, weekdayNames: WEEKDAYS_SHORT };
    const builtIn = { locale: null, monthNames: defaults.nominative, weekdayNames: defaultWeekdays.short };

    const specs = [];
    for (const year of YEARS) {
        for (const month of MONTHS) {
            for (const weekStartsOnMonday of ORIENTATIONS) {
                for (const mode of MODES) {
                    specs.push({ year, month, weekStartsOnMonday, mode, ...synthetic });
                }
            }
        }
    }
    for (const month of MONTHS) {
        for (const weekStartsOnMonday of ORIENTATIONS) {
            specs.push({ year: 2026, month, weekStartsOnMonday, mode: 'inline', ...builtIn });
        }
    }

    const coverage = assertMatrixCoverage(specs);
    const canarySpec = { year: 2026, month: 10, weekStartsOnMonday: true, mode: 'inline', ...synthetic };
    const canaryResult = canary(runtime, canarySpec);

    const cases = [];
    for (const spec of specs) {
        const label = `${spec.year}-${String(spec.month + 1).padStart(2, '0')}`
            + ` ${spec.weekStartsOnMonday ? 'mon-first' : 'sun-first'} ${spec.mode}`
            + `${spec.locale === null ? ' default-locale' : ''}`;
        const outcome = runCase(runtime, spec);
        for (const problem of outcome.harness) {
            harnessProblems.push(`${label}: ${problem}`);
        }
        for (const { phase, checks } of outcome.results) {
            cases.push({ label, phase, checks });
        }
    }

    /* Probed on the first month that actually failed, so the comparison is about the same
       day count the click path got wrong. */
    const firstFailing = cases.find(entry => entry.phase === 'after click' && entry.checks.some(check => !check.ok));
    const probeSpec = firstFailing === undefined
        ? { year: 2026, month: 10, weekStartsOnMonday: true, mode: 'inline', ...synthetic }
        : {
            year: Number(firstFailing.label.slice(0, 4)),
            month: Number(firstFailing.label.slice(5, 7)) - 1,
            weekStartsOnMonday: true,
            mode: 'inline',
            ...synthetic
        };
    const numericFailures = probeNumericPath(runtime, probeSpec);
    const clickFailures = cases
        .filter(entry => entry.label.startsWith(`${probeSpec.year}-${String(probeSpec.month + 1).padStart(2, '0')}`)
            && entry.label.includes('mon-first inline') && !entry.label.includes('default-locale'))
        .find(entry => entry.phase === 'after click')
        ?.checks.filter(check => !check.ok).map(check => check.name) ?? [];

    return { specs, cases, coverage, canary: canaryResult, harnessProblems, probeSpec, numericFailures, clickFailures };
}

/* ---------------------------------------------------------------- picker invariants */

/** Years a picker offers before its pivot, and years after it. */
const PICKER_YEARS_BEFORE = 7;
const PICKER_YEARS_AFTER = 10;

/** Year buttons the year picker draws — which is also the step its arrows have to take. */
const PICKER_YEAR_BUTTONS = PICKER_YEARS_BEFORE + PICKER_YEARS_AFTER + 1;

/** The single class that shows a picker; the closed state is the stylesheet's `display: none`. */
const PICKER_OPEN = 'cw___picker--open';

/** Caption text `#buildPickerControl` writes before any picker has been told a pivot. */
const DORMANT_CAPTION = '-';

/** Years and months the picker matrix walks: a leap February, a plain one, both year edges. */
const PICKER_YEARS = [1999, 2000, 2026, 2027];
const PICKER_MONTHS = [0, 1, 6, 11];

/** @param {StubElement|null} element @returns {boolean} */
function pickerIsOpen(element) {
    return element !== null && element.classList.contains(PICKER_OPEN);
}

/**
 * Reads a caption of the shape `<first> — <last>`, whatever separator it is written with.
 *
 * The placeholder matches nothing, which is the point: a caption still reading `-` carries no
 * years and must never satisfy an expectation about a range.
 *
 * @param {string} text
 * @returns {{first: number|null, last: number|null, separator: string|null}}
 */
function readRangeCaption(text) {
    const match = /^(\d+)\s*(\S+)\s*(\d+)$/.exec(text);
    if (match === null) {
        return { first: null, last: null, separator: null };
    }

    return { first: Number(match[1]), last: Number(match[3]), separator: match[2] };
}

/**
 * The two picker captions and the years the year buttons are addressed by, as one value.
 *
 * @param {StubDocument} document
 * @returns {{month: string, range: string, first: number|null, last: number|null, years: string[]}}
 */
function readPickerState(document) {
    const month = document.querySelector('.cw___captionMonth');
    const range = document.querySelector('.cw___captionYear');
    const parsed = readRangeCaption(range === null ? '' : range.textContent);

    return {
        month: month === null ? '' : month.textContent,
        range: range === null ? '' : range.textContent,
        first: parsed.first,
        last: parsed.last,
        years: document.querySelectorAll('.cw___yearButton').map(button => button.getAttribute('data-year') ?? '')
    };
}

/**
 * The arrows of one picker's control row, found the way `calendar.js` finds them: positionally,
 * first and third child, because the arrows carry no class telling the two pickers apart.
 *
 * @param {StubDocument} document
 * @param {'month'|'year'} which
 * @returns {{left: StubElement|null, right: StubElement|null}}
 */
function pickerArrows(document, which) {
    const control = document.querySelector(`.cw___picker--${which} .cw___monthControl`);
    if (control === null) {
        return { left: null, right: null };
    }

    return { left: control.children[0] ?? null, right: control.children[2] ?? null };
}

/**
 * Asserts everything both pickers are responsible for at one moment: which overlay is showing,
 * what its captions say, how its buttons are addressed, and where the selection marks land.
 *
 * The expectations are derived from `pivot` and `selection` alone, never from what the picker
 * currently shows, so a stale pivot and a stale mark are both failures rather than agreement.
 *
 * @param {{
 *     document: StubDocument,
 *     pivot: number,
 *     selection: {year: number, month: number, day: number}|null,
 *     monthOpen: boolean,
 *     yearOpen: boolean,
 *     monthNames: string[]
 * }} input
 * @param {{monthMark: number, noMonthMark: number, yearMark: number, noYearMark: number}|null} [branches]
 *     tally of which mark branch this state exercised; both branches have to be reached, or an
 *     expectation of "no mark" would be passing because nothing ever asks for one
 * @returns {CheckResult[]}
 */
function inspectPickers({ document, pivot, selection, monthOpen, yearOpen, monthNames }, branches = null) {
    const results = [];
    const record = (name, ok, detail = '', skipped = false) => {
        results.push({ name, ok, detail, skipped });
    };

    const monthPicker = document.querySelector('.cw___picker--month');
    const yearPicker = document.querySelector('.cw___picker--year');
    if (monthPicker === null || yearPicker === null) {
        record('pickersPresent', false,
            `month picker ${monthPicker === null ? 'missing' : 'present'},`
            + ` year picker ${yearPicker === null ? 'missing' : 'present'}`);
        return results;
    }
    record('pickersPresent', true, 'both overlays are in the root');

    const monthState = pickerIsOpen(monthPicker) ? 'open' : 'closed';
    const yearState = pickerIsOpen(yearPicker) ? 'open' : 'closed';
    record('pickerOpenState',
        monthState === (monthOpen ? 'open' : 'closed') && yearState === (yearOpen ? 'open' : 'closed'),
        `month picker ${monthState}, year picker ${yearState};`
            + ` expected ${monthOpen ? 'open' : 'closed'} and ${yearOpen ? 'open' : 'closed'}`);

    for (const [which, picker, captionClass] of [
        ['month', monthPicker, 'cw___captionMonth'],
        ['year', yearPicker, 'cw___captionYear']
    ]) {
        const control = picker.querySelector('.cw___monthControl');
        const children = control === null ? [] : control.children;
        record('pickerControlRow',
            children.length === 3
                && children[0].classList.contains('cw___buttonJump')
                && children[2].classList.contains('cw___buttonJump')
                && children[1].classList.contains(captionClass),
            `${which} control: ${children.length} children, [${children.map(child => child.className).join(' | ')}]`);
    }

    const first = pivot - PICKER_YEARS_BEFORE;
    const last = pivot + PICKER_YEARS_AFTER;

    const monthCaption = monthPicker.querySelector('.cw___captionMonth');
    const monthText = monthCaption === null ? '' : monthCaption.textContent;
    record('monthPickerCaption', monthText === String(pivot),
        `month caption reads "${monthText}", expected the pivot "${pivot}"`);

    const yearCaption = yearPicker.querySelector('.cw___captionYear');
    const yearText = yearCaption === null ? '' : yearCaption.textContent;
    const range = readRangeCaption(yearText);
    record('yearPickerCaption', range.first === first && range.last === last,
        `year caption reads "${yearText}", expected the pivot range ${first} … ${last}`);

    record('captionPopulated', monthText !== DORMANT_CAPTION && range.first !== null,
        `month caption "${monthText}", year caption "${yearText}";`
        + ` a caption still reading "${DORMANT_CAPTION}" was never told a pivot`);

    const yearButtons = yearPicker.querySelectorAll('.cw___yearButton');
    record('yearButtonCount', yearButtons.length === PICKER_YEAR_BUTTONS,
        `${yearButtons.length} year buttons, expected ${PICKER_YEAR_BUTTONS}`);

    const carried = yearButtons.map(button => button.getAttribute('data-year'));
    const indexed = carried.every((value, index) => value === String(index));
    record('yearButtonDataYear', carried.every((value, index) => Number(value) === first + index),
        `data-year [${preview(carried, 4)}], expected ${first}…${last}`
        + `${indexed ? ' — these are the 0..17 indices, not years' : ''}`);

    const relabelled = carried
        .map((value, index) => (yearButtons[index].textContent === value ? null : `${value}/${yearButtons[index].textContent}`))
        .filter(entry => entry !== null);
    record('yearButtonLabel', relabelled.length === 0,
        relabelled.length === 0
            ? `every year button reads the year it is addressed by`
            : `${relabelled.length}/${yearButtons.length} year buttons read something else: ${preview(relabelled)}`);

    const monthButtons = monthPicker.querySelectorAll('.cw___monthButton');
    const months = monthButtons.map(button => button.getAttribute('data-month'));
    const addressed = MONTHS.every(month => months.filter(value => Number(value) === month).length === 1);
    record('monthButtonCount', monthButtons.length === 12 && addressed,
        `${monthButtons.length} month buttons, data-month [${preview(months, 6)}]`);

    const misnamed = [];
    monthButtons.forEach((button, index) => {
        const month = Number(months[index]);
        if (button.textContent !== monthNames[month]) {
            misnamed.push(`${month}: ${button.textContent}`);
        }
    });
    record('monthButtonLabel', misnamed.length === 0,
        misnamed.length === 0
            ? `every month button reads the month it is addressed by`
            : `${misnamed.length} month buttons read another month's name: ${preview(misnamed)}`);

    const markedMonths = monthPicker.querySelectorAll('.cw___selectedMonth');
    const monthMarkWanted = selection !== null && selection.year === pivot;
    if (branches !== null) {
        branches[monthMarkWanted ? 'monthMark' : 'noMonthMark'] += 1;
    }
    record('selectedMonthMark',
        markedMonths.length === (monthMarkWanted ? 1 : 0)
            && (!monthMarkWanted || Number(markedMonths[0].getAttribute('data-month')) === selection.month),
        monthMarkWanted
            ? `${markedMonths.length} month buttons marked, expected 1 on data-month ${selection.month}`
            : `${markedMonths.length} month buttons marked, expected none`
                + (selection === null ? ' (nothing is selected)' : ` (selection is in ${selection.year}, the pivot is ${pivot})`));

    const markedYears = yearPicker.querySelectorAll('.cw___selectedYear');
    const yearMarkWanted = selection !== null && selection.year >= first && selection.year <= last;
    if (branches !== null) {
        branches[yearMarkWanted ? 'yearMark' : 'noYearMark'] += 1;
    }
    record('selectedYearMark',
        markedYears.length === (yearMarkWanted ? 1 : 0)
            && (!yearMarkWanted || Number(markedYears[0].getAttribute('data-year')) === selection.year),
        yearMarkWanted
            ? `${markedYears.length} year buttons marked, expected 1 on ${selection.year}`
            : `${markedYears.length} year buttons marked, expected none`
                + (selection === null
                    ? ' (nothing is selected)'
                    : ` (${selection.year} is outside ${first} … ${last})`));

    return results;
}

/* ---------------------------------------------------------------------- the picker matrix */

/**
 * Drives one calendar through the picker paths a pointer can take: opening each overlay from
 * its own caption, choosing a month, choosing a year, paging the pivot with all four arrows,
 * and marking — then clearing — a selection.
 *
 * Every control is looked up again after each action: `#render()` replaces the whole root, so
 * a node held across an action is detached from the calendar and clicks on it would never
 * reach the delegated handler.
 *
 * @param {{Calendar: Function, freshDocument: () => StubDocument}} runtime
 * @param {CaseSpec} spec
 * @returns {{phases: {label: string, checks: CheckResult[]}[], harness: string[], branches: object}}
 */
function runPickerCase(runtime, spec) {
    const phases = [];
    const harness = [];
    const branches = { monthMark: 0, noMonthMark: 0, yearMark: 0, noYearMark: 0 };
    const pivot = spec.year;
    const first = pivot - PICKER_YEARS_BEFORE;
    const selection = { year: spec.year, month: spec.month };
    const day = Math.min(15, new Date(spec.year, spec.month + 1, 0).getDate());

    const newCalendar = () => {
        const document = runtime.freshDocument();
        const { calendar } = mount(document, runtime.Calendar, spec);
        return { document, calendar };
    };

    /** Clicks a control, recording the failure rather than throwing when nothing matches. */
    const press = (document, selector, checks, what) => {
        const element = document.querySelector(selector);
        if (element === null) {
            checks.push({
                name: 'pickerControlPresent',
                ok: false,
                detail: `${what}: nothing matches ${selector}`,
                skipped: false
            });
            harness.push(`${what}: nothing matches ${selector}`);
            return null;
        }

        element.dispatchEvent({ type: 'click', target: element });
        return element;
    };

    const phase = (label, checks) => phases.push({ label, checks });
    const inspect = (document, over) => inspectPickers({
        document,
        pivot,
        selection: null,
        monthOpen: true,
        yearOpen: false,
        monthNames: spec.monthNames,
        ...over
    }, branches);

    {
        const { document } = newCalendar();
        const opened = [];
        press(document, '.cw___monthChange', opened, 'opening the month picker');
        phase('month picker open', [...opened, ...inspect(document)]);

        const intoYear = [];
        press(document, '.cw___captionMonth', intoYear, 'opening the year picker');
        phase('year picker open', [...intoYear, ...inspect(document, { yearOpen: true })]);
    }

    /* The path `#openYearPicker()` has to survive on its own: a root that has never been told
       a pivot, reached straight from the month picker's caption. Before `#updatePicker()` was
       called there too, this left the caption at `-` with `data-year` running `0..17`, so a
       click on any button landed on year 0. */
    {
        const { document } = newCalendar();
        const checks = [];
        press(document, '.cw___captionMonth', checks, 'opening the year picker without the month picker');
        phase('year picker opened directly', [...checks, ...inspect(document, { monthOpen: false, yearOpen: true })]);
    }

    {
        const { document } = newCalendar();
        const checks = [];
        press(document, '.cw___monthChange', checks, 'opening the month picker');

        const wanted = (spec.month + 7) % 12;
        const button = document.querySelectorAll('.cw___monthButton')
            .find(candidate => Number(candidate.getAttribute('data-month')) === wanted) ?? null;
        if (button === null) {
            checks.push({
                name: 'pickerControlPresent',
                ok: false,
                detail: `no month button carries data-month ${wanted}`,
                skipped: false
            });
            harness.push(`month pick: no button carries data-month ${wanted}`);
        } else {
            button.dispatchEvent({ type: 'click', target: button });

            const caption = document.querySelector('.cw___monthChange');
            const drawn = caption === null ? '' : caption.textContent;
            const marked = document.querySelectorAll('td.cw___day').length;
            const days = new Date(pivot, wanted + 1, 0).getDate();
            checks.push({
                name: 'monthPickApplies',
                ok: drawn === `${spec.monthNames[wanted]} ${pivot}` && marked === days,
                detail: `picked month ${wanted}: caption reads "${drawn}", expected`
                    + ` "${spec.monthNames[wanted]} ${pivot}"; ${marked} day cells marked for a ${days} day month`
            });

            const monthPicker = document.querySelector('.cw___picker--month');
            const yearPicker = document.querySelector('.cw___picker--year');
            checks.push({
                name: 'monthPickCloses',
                ok: monthPicker !== null && yearPicker !== null
                    && !pickerIsOpen(monthPicker) && !pickerIsOpen(yearPicker),
                detail: `month picker ${monthPicker === null ? 'missing' : pickerIsOpen(monthPicker) ? 'open' : 'closed'},`
                    + ` year picker ${yearPicker === null ? 'missing' : pickerIsOpen(yearPicker) ? 'open' : 'closed'}`
            });

            press(document, '.cw___monthChange', checks, 'reopening the month picker after a month pick');
            checks.push(...inspect(document));
        }

        phase('month button click', checks);
    }

    {
        const { document } = newCalendar();
        const checks = [];
        press(document, '.cw___monthChange', checks, 'opening the month picker');
        press(document, '.cw___captionMonth', checks, 'opening the year picker');

        /* The fourth year button, expected at `pivot − 4` — an index the checker derives, not
           one it reads back from the attribute it is checking. */
        const index = 3;
        const wanted = first + index;
        const button = document.querySelectorAll('.cw___yearButton')[index] ?? null;
        if (button === null) {
            checks.push({
                name: 'pickerControlPresent',
                ok: false,
                detail: `the year picker has no button at index ${index}`,
                skipped: false
            });
            harness.push(`year pick: no year button at index ${index}`);
        } else {
            button.dispatchEvent({ type: 'click', target: button });

            const yearPicker = document.querySelector('.cw___picker--year');
            checks.push({
                name: 'yearPickCloses',
                ok: yearPicker !== null && !pickerIsOpen(yearPicker),
                detail: `year picker ${yearPicker === null ? 'missing' : pickerIsOpen(yearPicker) ? 'open' : 'closed'}`
                    + ` after clicking the button reading "${button.textContent}"`
            });

            const after = readPickerState(document);
            checks.push({
                name: 'yearPickApplies',
                ok: after.month === String(wanted)
                    && after.first === wanted - PICKER_YEARS_BEFORE
                    && after.last === wanted + PICKER_YEARS_AFTER,
                detail: `clicked the button reading "${button.textContent}": captions now read`
                    + ` "${after.month}" and "${after.range}", expected "${wanted}" and`
                    + ` ${wanted - PICKER_YEARS_BEFORE} … ${wanted + PICKER_YEARS_AFTER}`
            });

            press(document, '.cw___monthChange', checks, 'reopening the month picker after a year pick');
            checks.push(...inspect(document, { pivot: wanted }));
        }

        phase('year button click', checks);
    }

    for (const [which, sides] of [
        ['month', ['left', 'left', 'right', 'right', 'right']],
        ['year', ['right', 'right', 'left', 'left']]
    ]) {
        /* One year for the month picker's arrows, the whole width of the year range for the
           year picker's — the step inherited from the legacy code and easy to get wrong. */
        const step = which === 'month' ? 1 : PICKER_YEAR_BUTTONS;
        const { document } = newCalendar();
        const checks = [];
        press(document, '.cw___monthChange', checks, `opening the month picker before paging the ${which} picker`);
        if (which === 'year') {
            press(document, '.cw___captionMonth', checks, 'opening the year picker');
        }

        const arrows = pickerArrows(document, which);
        let expected = pivot;
        for (const side of sides) {
            const arrow = side === 'left' ? arrows.left : arrows.right;
            if (arrow === null) {
                checks.push({
                    name: 'pickerControlPresent',
                    ok: false,
                    detail: `the ${which} picker has no ${side} arrow`,
                    skipped: false
                });
                harness.push(`${which} picker: no ${side} arrow`);
                continue;
            }

            arrow.dispatchEvent({ type: 'click', target: arrow });
            expected += side === 'left' ? -step : step;
            const after = readPickerState(document);
            checks.push({
                name: `${which}ArrowStep`,
                ok: after.month === String(expected)
                    && after.first === expected - PICKER_YEARS_BEFORE
                    && after.last === expected + PICKER_YEARS_AFTER
                    && after.years.length === PICKER_YEAR_BUTTONS
                    && after.years[0] === String(expected - PICKER_YEARS_BEFORE)
                    && after.years.at(-1) === String(expected + PICKER_YEARS_AFTER),
                detail: `the ${which} picker ${side} arrow moved the pivot to ${expected}:`
                    + ` caption "${after.month}", range "${after.range}",`
                    + ` data-year ${preview(after.years, 2)}…${preview(after.years.slice(-1))}`
            });
        }

        checks.push(...inspect(document, { pivot: expected, yearOpen: which === 'year' }));
        phase(`${which} picker arrows`, checks);
    }

    {
        const { document, calendar } = newCalendar();
        const checks = [];
        calendar.setDateSelect(spec.year, spec.month, day);
        press(document, '.cw___monthChange', checks, 'opening the month picker over a selection');
        checks.push(...inspect(document, { selection }));

        press(document, '.cw___captionMonth', checks, 'opening the year picker over a selection');
        checks.push(...inspect(document, { selection, yearOpen: true }));

        /* Two widths of the year range take the selected year off screen; the marks have to go
           with it rather than stay behind on a stale button. */
        const right = pickerArrows(document, 'year').right;
        if (right === null) {
            checks.push({
                name: 'pickerControlPresent',
                ok: false,
                detail: 'the year picker has no right arrow',
                skipped: false
            });
            harness.push('selection marks: no right arrow on the year picker');
        } else {
            for (let width = 0; width < 2; width++) {
                right.dispatchEvent({ type: 'click', target: right });
            }
            const paged = pivot + PICKER_YEAR_BUTTONS * 2;
            const after = readPickerState(document);
            checks.push({
                name: 'selectionPagedOut',
                ok: after.month === String(paged) && !after.years.includes(String(pivot)),
                detail: `the pivot reads "${after.month}" after two presses, expected "${paged}";`
                    + ` data-year ${preview(after.years, 2)}…${preview(after.years.slice(-1))}`
            });
            checks.push(...inspect(document, { pivot: paged, selection, yearOpen: true }));
        }

        phase('selection marks', checks);
    }

    {
        const { document, calendar } = newCalendar();
        const checks = [];
        calendar.setDateSelect(spec.year, spec.month, day);
        calendar.resetDateSelect();

        const cleared = calendar.getDateSelect();
        checks.push({
            name: 'selectionCleared',
            ok: cleared.year === '0' && cleared.month === '01' && cleared.day === '00',
            detail: `getDateSelect reads ${cleared.year}.${cleared.month}.${cleared.day}`
                + ` after resetDateSelect, expected 0.01.00`
        });

        press(document, '.cw___monthChange', checks, 'opening the month picker after the selection was cleared');
        checks.push(...inspect(document));

        press(document, '.cw___captionMonth', checks, 'opening the year picker after the selection was cleared');
        checks.push(...inspect(document, { yearOpen: true }));

        phase('cleared selection', checks);
    }

    /* Every path that can reach the year picker has to leave the same captions behind: the
       paths a real pointer can take, plus the one no pointer can and the opener still has to
       survive — a root nothing has repainted since it was built. */
    {
        const paths = [
            ['through the month picker', (document, calendar, checks) => {
                press(document, '.cw___monthChange', checks, 'month caption');
                press(document, '.cw___captionMonth', checks, 'year caption');
            }],
            ['straight from the year caption', (document, calendar, checks) => {
                press(document, '.cw___captionMonth', checks, 'year caption');
            }],
            ['after a day click', (document, calendar, checks) => {
                const cell = findCell(document, spec.year, spec.month, day);
                if (cell === null) {
                    checks.push({
                        name: 'pickerControlPresent',
                        ok: false,
                        detail: `no cell carries data-date ${spec.year}.${spec.month}.${day}`,
                        skipped: false
                    });
                    harness.push(`open paths: no cell for ${spec.year}.${spec.month}.${day}`);
                    return;
                }
                cell.dispatchEvent({ type: 'click', target: cell });
                /* The day click leaves a selection behind, which legitimately marks a button;
                   clearing it keeps the comparison about the captions alone. */
                calendar.resetDateSelect();
                press(document, '.cw___monthChange', checks, 'month caption');
                press(document, '.cw___captionMonth', checks, 'year caption');
            }],
            ['after a month button click', (document, calendar, checks) => {
                press(document, '.cw___monthChange', checks, 'month caption');
                const wanted = (spec.month + 7) % 12;
                const button = document.querySelectorAll('.cw___monthButton')
                    .find(candidate => Number(candidate.getAttribute('data-month')) === wanted) ?? null;
                if (button === null) {
                    checks.push({
                        name: 'pickerControlPresent',
                        ok: false,
                        detail: `no month button carries data-month ${wanted}`,
                        skipped: false
                    });
                    harness.push(`open paths: no button for month ${wanted}`);
                    return;
                }
                button.dispatchEvent({ type: 'click', target: button });
                press(document, '.cw___monthChange', checks, 'month caption');
                press(document, '.cw___captionMonth', checks, 'year caption');
            }]
        ];

        const seen = [];
        for (const [label, drive] of paths) {
            const { document, calendar } = newCalendar();
            const checks = [];
            drive(document, calendar, checks);
            const after = readPickerState(document);
            seen.push({
                label,
                checks,
                signature: `${after.month} | ${after.range} | ${after.years.join(',')}`
            });
        }

        const [reference, ...rest] = seen;
        const checks = rest.flatMap(entry => {
            entry.checks.push({
                name: 'openPathCaptionsMatch',
                ok: entry.signature === reference.signature,
                detail: `opened ${entry.label}: "${entry.signature}";`
                    + ` opened ${reference.label}: "${reference.signature}"`
            });
            return entry.checks;
        });
        checks.push({
            name: 'openPathCaptionsPopulated',
            ok: seen.every(entry => readRangeCaption(entry.signature.split(' | ')[1]).first !== null),
            detail: seen.map(entry => `${entry.label} -> "${entry.signature.split(' | ')[1]}"`).join('; ')
        });

        phase('open paths', checks);
    }

    return { phases, harness, branches };
}

/**
 * Injects six defects into a live picker state and insists the checker reports each, so a run
 * that cannot fail cannot be reported as green.
 *
 * Each injection writes into the very node the invariant under test reads, and is read back to
 * confirm it changed something: an injection into a node that already held the value would land
 * invisibly and leave the assertion it was meant to disqualify looking perfectly sensitive.
 * The baseline is therefore required to be empty — an invariant that was already failing would
 * mask every injection aimed at it.
 *
 * The state is the one a real pointer leaves behind most often: the month overlay open over a
 * selection, the year overlay closed but already repainted by the same update.
 *
 * @param {{Calendar: Function, freshDocument: () => StubDocument}} runtime
 * @param {CaseSpec} spec
 * @returns {{baseline: string[], marks: {name: string, extra: string[], landed: boolean}[], landed: boolean}}
 */
function canaryPicker(runtime, spec) {
    const document = runtime.freshDocument();
    const { calendar } = mount(document, runtime.Calendar, spec);
    const selection = { year: spec.year, month: spec.month };
    calendar.setDateSelect(spec.year, spec.month, Math.min(15, new Date(spec.year, spec.month + 1, 0).getDate()));
    const gridCaption = document.querySelector('.cw___monthChange');
    gridCaption.dispatchEvent({ type: 'click', target: gridCaption });

    const inspect = () => inspectPickers({
        document,
        pivot: spec.year,
        selection,
        monthOpen: true,
        yearOpen: false,
        monthNames: spec.monthNames
    });
    const baseline = inspect().filter(check => !check.ok).map(check => check.name);

    /**
     * @param {string} name
     * @param {() => boolean} apply writes the defect, returns whether it landed
     * @param {() => void} revert
     */
    const inject = (name, apply, revert) => {
        const landed = apply();
        const extra = inspect().filter(check => !check.ok).map(check => check.name)
            .filter(failing => !baseline.includes(failing));
        revert();
        return { name, extra, landed };
    };

    const index = 5;
    const yearButton = document.querySelectorAll('.cw___yearButton')[index];
    const yearCaption = document.querySelector('.cw___captionYear');
    const monthCaption = document.querySelector('.cw___captionMonth');
    const yearRange = yearCaption.textContent;
    const monthRange = monthCaption.textContent;
    const yearWas = yearButton.getAttribute('data-year');
    const yearPicker = document.querySelector('.cw___picker--year');
    const otherYear = document.querySelectorAll('.cw___yearButton')[2];
    const otherMonth = document.querySelectorAll('.cw___monthButton')[1];

    const marks = [
        /* The pre-`#updatePicker` encoding: a button addressed by its own index. */
        inject('data-year forced back to its index',
            () => {
                yearButton.setAttribute('data-year', String(index));
                return yearWas !== String(index) && yearButton.getAttribute('data-year') === String(index);
            },
            () => yearButton.setAttribute('data-year', yearWas)),
        inject('year range caption blanked',
            () => {
                yearCaption.textContent = DORMANT_CAPTION;
                return yearRange !== DORMANT_CAPTION && yearCaption.textContent === DORMANT_CAPTION;
            },
            () => {
                yearCaption.textContent = yearRange;
            }),
        inject('month caption blanked',
            () => {
                monthCaption.textContent = DORMANT_CAPTION;
                return monthRange !== DORMANT_CAPTION && monthCaption.textContent === DORMANT_CAPTION;
            },
            () => {
                monthCaption.textContent = monthRange;
            }),
        inject('cw___picker--open forced onto the closed year overlay',
            () => {
                const was = pickerIsOpen(yearPicker);
                yearPicker.classList.add(PICKER_OPEN);
                return !was && pickerIsOpen(yearPicker);
            },
            () => yearPicker.classList.remove(PICKER_OPEN)),
        inject('cw___selectedYear forced onto a second year button',
            () => {
                otherYear.classList.add('cw___selectedYear');
                return document.querySelectorAll('.cw___selectedYear').length === 2;
            },
            () => otherYear.classList.remove('cw___selectedYear')),
        inject('cw___selectedMonth forced onto a second month button',
            () => {
                otherMonth.classList.add('cw___selectedMonth');
                return document.querySelectorAll('.cw___selectedMonth').length === 2;
            },
            () => otherMonth.classList.remove('cw___selectedMonth'))
    ];

    return { baseline, marks, landed: marks.every(mark => mark.landed) };
}

/**
 * Both mark branches have to be reached, or an expectation of "no mark" would keep passing
 * simply because no state ever asked for one.
 *
 * @param {ReturnType<typeof runPickerCase>[]} outcomes
 * @returns {{ok: boolean, detail: string}}
 */
function assertPickerBranchCoverage(outcomes) {
    const tally = outcomes.reduce((sum, outcome) => {
        for (const [branch, count] of Object.entries(outcome.branches)) {
            sum[branch] += count;
        }
        return sum;
    }, { monthMark: 0, noMonthMark: 0, yearMark: 0, noYearMark: 0 });

    const reached = Object.values(tally).every(count => count > 0);
    return {
        ok: reached,
        detail: `cw___selectedMonth expected in ${tally.monthMark} states and absent in ${tally.noMonthMark};`
            + ` cw___selectedYear expected in ${tally.yearMark} states and absent in ${tally.noYearMark};`
            + ` month arrows stepped by 1 and year arrows by ${PICKER_YEAR_BUTTONS}`
    };
}

/**
 * @param {{Calendar: Function, freshDocument: () => StubDocument}} runtime
 * @returns {{specs: CaseSpec[], cases: {label: string, checks: CheckResult[]}[], canary: ReturnType<typeof canaryPicker>, harnessProblems: string[], coverage: {ok: boolean, detail: string}}}
 */
function runPickerMatrix(runtime) {
    const specs = [];
    for (const year of PICKER_YEARS) {
        for (const month of PICKER_MONTHS) {
            for (const mode of MODES) {
                specs.push({ year, month, weekStartsOnMonday: true, mode, locale: SYNTHETIC_LOCALE, monthNames: MONTH_NAMES, weekdayNames: WEEKDAYS_SHORT });
            }
        }
    }

    const harnessProblems = [];
    const cases = [];
    const outcomes = [];
    for (const spec of specs) {
        const label = `${spec.year}-${String(spec.month + 1).padStart(2, '0')} ${spec.mode} picker`;
        const outcome = runPickerCase(runtime, spec);
        outcomes.push(outcome);
        harnessProblems.push(...outcome.harness.map(problem => `${label}: ${problem}`));
        for (const { label: phaseLabel, checks } of outcome.phases) {
            cases.push({ label: `${label} / ${phaseLabel}`, checks });
        }
    }

    const canarySpec = { year: 2026, month: 10, weekStartsOnMonday: true, mode: 'inline', locale: SYNTHETIC_LOCALE, monthNames: MONTH_NAMES, weekdayNames: WEEKDAYS_SHORT };
    return {
        specs,
        cases,
        canary: canaryPicker(runtime, canarySpec),
        harnessProblems,
        coverage: assertPickerBranchCoverage(outcomes)
    };
}

/* ------------------------------------------------------------------------- report */

/**
 * @param {ReturnType<typeof runMatrix>} matrix
 * @param {ReturnType<typeof runPickerMatrix>} pickers
 * @param {string} sourceLabel
 * @returns {{text: string, exitCode: number}}
 */
function report(matrix, pickers, sourceLabel) {
    const lines = [];
    const invariants = [...new Set(matrix.cases.flatMap(entry => entry.checks.map(check => check.name)))]
        .sort((left, right) => (left < right ? -1 : 1));
    const totalChecks = matrix.cases.reduce((sum, entry) => sum + entry.checks.length, 0);
    const skippedChecks = matrix.cases.reduce((sum, entry) => sum + entry.checks.filter(check => check.skipped).length, 0);
    const failedChecks = matrix.cases.reduce((sum, entry) => sum + entry.checks.filter(check => !check.ok).length, 0);
    const dayCellsRead = matrix.cases.length * 42;

    const pickerInvariants = [...new Set(pickers.cases.flatMap(entry => entry.checks.map(check => check.name)))]
        .sort((left, right) => (left < right ? -1 : 1));
    const pickerChecks = pickers.cases.reduce((sum, entry) => sum + entry.checks.length, 0);
    const pickerFailed = pickers.cases.reduce((sum, entry) => sum + entry.checks.filter(check => !check.ok).length, 0);
    const pickerSkipped = pickers.cases.reduce((sum, entry) => sum + entry.checks.filter(check => check.skipped).length, 0);

    lines.push('== calendar grid regression check ==');
    lines.push(`source            ${sourceLabel}`);
    lines.push('harness           node:vm context + minimal DOM stub, real Calendar class, real click path');
    lines.push(`calendars built   ${matrix.specs.length}`);
    lines.push(`renders inspected ${matrix.cases.length}`);
    lines.push(`day cells read    ${dayCellsRead}`);
    lines.push(`invariants        ${invariants.length} per render, ${totalChecks} checks (${skippedChecks} skipped)`);
    lines.push(`picker states     ${pickers.cases.length} across ${pickers.specs.length} calendars`);
    lines.push(`picker invariants ${pickerInvariants.length} per state, ${pickerChecks} checks (${pickerSkipped} skipped)`);

    lines.push('');
    lines.push('-- harness self-checks --');
    /* Each canary injection must land *and* be reported, which is what separates "the
       assertion ran" from "the assertion cannot fail". */
    const canaryWanted = ['dayClassCount', 'dayClassRange', 'spillOutsideMonth'];
    const canaryOk = matrix.canary.landed
        && matrix.canary.marks.length === 2
        && matrix.canary.marks.every((mark, index) => canaryWanted.slice(index * 2, index * 2 + 2)
            .every(wanted => mark.extra.includes(wanted)));
    for (const mark of matrix.canary.marks) {
        lines.push(`${canaryOk ? 'ok  ' : 'FAIL'}  canary           ${mark.name}`
            + ` -> [${mark.extra.join(' ')}] (landed: ${mark.landed})`);
    }
    lines.push(`${matrix.coverage.ok ? 'ok  ' : 'FAIL'}  matrix coverage  ${matrix.coverage.detail}`);
    lines.push(`${pickers.coverage.ok ? 'ok  ' : 'FAIL'}  picker coverage  ${pickers.coverage.detail}`);
    const transitions = matrix.harnessProblems.length === 0;
    lines.push(`${transitions ? 'ok  ' : 'FAIL'}  click path       ${transitions
        ? `all ${matrix.specs.length} clicks rebuilt the root, moved the selection and marked the clicked cell`
        : `${matrix.harnessProblems.length} clicks did not`}`);
    const probe = matrix.probeSpec;
    const probeLabel = `${probe.year}-${String(probe.month + 1).padStart(2, '0')}`;
    lines.push(`${matrix.numericFailures.length === 0 ? 'ok  ' : 'FAIL'}  differential     ${probeLabel} drawn after a click`
        + ` -> [${matrix.clickFailures.join(' ')}]`);
    lines.push(`                      ${probeLabel} drawn through setDateSelect (numbers)`
        + ` -> ${matrix.numericFailures.length === 0 ? 'all invariants hold' : `failed [${matrix.numericFailures.join(' ')}]`}`);
    for (const problem of matrix.harnessProblems.slice(0, 5)) {
        lines.push(`FAIL  click path       ${problem}`);
    }

    /* The same rule for the pickers: each injected defect must land *and* be reported by the
       invariant it was aimed at, which is what separates "the assertion ran" from "the
       assertion cannot fail". */
    const PICKER_CANARY_WANTED = [
        ['data-year forced back to its index', 'yearButtonDataYear'],
        ['year range caption blanked', 'yearPickerCaption'],
        ['month caption blanked', 'monthPickerCaption'],
        ['cw___picker--open forced onto the closed year overlay', 'pickerOpenState'],
        ['cw___selectedYear forced onto a second year button', 'selectedYearMark'],
        ['cw___selectedMonth forced onto a second month button', 'selectedMonthMark']
    ];
    const pickerCanaryOk = pickers.canary.baseline.length === 0
        && pickers.canary.landed
        && pickers.canary.marks.length === PICKER_CANARY_WANTED.length
        && pickers.canary.marks.every((mark, index) => {
            const wanted = PICKER_CANARY_WANTED[index][1];
            return mark.name === PICKER_CANARY_WANTED[index][0] && mark.extra.includes(wanted);
        });
    for (const mark of pickers.canary.marks) {
        lines.push(`${pickerCanaryOk ? 'ok  ' : 'FAIL'}  canary           picker: ${mark.name}`
            + ` -> [${mark.extra.join(' ')}] (landed: ${mark.landed})`);
    }
    lines.push(`${pickerCanaryOk ? 'ok  ' : 'FAIL'}  canary baseline  picker: ${
        pickers.canary.baseline.length === 0
            ? 'the injected state holds before anything is broken into it'
            : `already failing [${pickers.canary.baseline.join(' ')}], so no injection could be seen`}`);
    const pickerPathsOk = pickers.harnessProblems.length === 0;
    lines.push(`${pickerPathsOk ? 'ok  ' : 'FAIL'}  picker paths     ${pickerPathsOk
        ? `every picker control of all ${pickers.cases.length} states was found and clicked`
        : `${pickers.harnessProblems.length} picker controls were missing`}`);
    for (const problem of pickers.harnessProblems.slice(0, 5)) {
        lines.push(`FAIL  picker paths     ${problem}`);
    }

    lines.push('');
    lines.push('-- per-invariant results --');
    for (const name of invariants) {
        const runs = matrix.cases.filter(entry => entry.checks.some(check => check.name === name));
        const failures = matrix.cases.filter(entry => entry.checks
            .some(check => check.name === name && !check.ok));
        lines.push(`${failures.length === 0 ? 'pass' : 'FAIL'}  ${name.padEnd(20)} ${failures.length}/${runs.length} renders`);
    }

    lines.push('');
    lines.push('-- per-invariant results, pickers --');
    for (const name of pickerInvariants) {
        const runs = pickers.cases.filter(entry => entry.checks.some(check => check.name === name));
        const failures = pickers.cases.filter(entry => entry.checks
            .some(check => check.name === name && !check.ok));
        lines.push(`${failures.length === 0 ? 'pass' : 'FAIL'}  ${name.padEnd(24)} ${failures.length}/${runs.length} states`);
    }

    lines.push('');
    lines.push('-- picker states by phase --');
    for (const phase of [...new Set(pickers.cases.map(entry => entry.label.split(' / ')[1]))]) {
        const runs = pickers.cases.filter(entry => entry.label.endsWith(` / ${phase}`));
        const failures = runs.filter(entry => entry.checks.some(check => !check.ok));
        lines.push(`${failures.length === 0 ? 'pass' : 'FAIL'}  ${phase.padEnd(24)} ${failures.length}/${runs.length} states`);
    }

    const failingPickerStates = pickers.cases.filter(entry => entry.checks.some(check => !check.ok));
    lines.push('');
    lines.push(`-- failing picker states (${failingPickerStates.length}) --`);
    const shownPicker = new Set();
    for (const entry of failingPickerStates) {
        if (shownPicker.has(entry.label)) {
            continue;
        }
        shownPicker.add(entry.label);
        lines.push(`  ${entry.label}`);
        for (const check of entry.checks.filter(failing => !failing.ok)) {
            lines.push(`      ${check.name}: ${check.detail}`);
        }
    }

    lines.push('');
    lines.push('-- failing renders by phase --');
    for (const phase of [...new Set(matrix.cases.map(entry => entry.phase))]) {
        const runs = matrix.cases.filter(entry => entry.phase === phase);
        const failures = runs.filter(entry => entry.checks.some(check => !check.ok));
        lines.push(`${failures.length === 0 ? 'pass' : 'FAIL'}  ${phase.padEnd(20)} ${failures.length}/${runs.length} renders`);
    }

    const byMonth = new Map();
    for (const entry of matrix.cases) {
        for (const check of entry.checks) {
            if (check.ok) {
                continue;
            }
            if (!byMonth.has(entry.label)) {
                byMonth.set(entry.label, new Set());
            }
            byMonth.get(entry.label).add(check.name);
        }
    }

    const failingMonths = [...byMonth.keys()]
        .filter(label => !label.includes('default-locale'))
        .map(label => label.slice(0, 7))
        .filter((label, index, all) => all.indexOf(label) === index)
        .sort();
    const localeOnly = [...byMonth.keys()].filter(label => label.includes('default-locale'));

    lines.push('');
    lines.push(`-- failing draws (${failingMonths.length} drawn months, ${byMonth.size} case labels) --`);
    for (const month of failingMonths) {
        lines.push(`  ${month} (${MONTH_EN[Number(month.slice(5, 7)) - 1]}), failing invariants:`
            + ` ${[...new Set(matrix.cases.filter(entry => entry.label.startsWith(month))
                .flatMap(entry => entry.checks.filter(check => !check.ok).map(check => check.name)))].sort().join(', ')}`);
    }
    for (const label of localeOnly) {
        lines.push(`  ${label}: ${[...byMonth.get(label)].sort().join(', ')}`);
    }

    lines.push('');
    lines.push('-- first failure per failing draw (detail) --');
    const shown = new Set();
    for (const entry of matrix.cases) {
        const month = entry.label.slice(0, 7);
        const key = `${month}|${entry.phase}`;
        if (shown.has(key)) {
            continue;
        }
        const failing = entry.checks.filter(check => !check.ok);
        if (failing.length === 0) {
            continue;
        }
        shown.add(key);
        lines.push(`  ${entry.label} / ${entry.phase}`);
        for (const check of failing) {
            lines.push(`      ${check.name}: ${check.detail}`);
        }
    }

    const green = failedChecks === 0
        && canaryOk
        && matrix.coverage.ok
        && transitions
        && matrix.harnessProblems.length === 0
        && pickerFailed === 0
        && pickerCanaryOk
        && pickers.coverage.ok
        && pickerPathsOk;

    lines.push('');
    lines.push(`checks ${totalChecks + pickerChecks}, failed ${failedChecks + pickerFailed}`
        + `  (grid ${totalChecks}/${failedChecks}, pickers ${pickerChecks}/${pickerFailed})`);
    lines.push(green
        ? 'RESULT: PASS'
        : `RESULT: FAIL (${failedChecks + pickerFailed} failed checks, exit 1)`);

    return { text: `${lines.join('\n')}\n`, exitCode: green ? 0 : 1 };
}

/* --------------------------------------------------------------------------- main */

try {
    const runtime = createRuntime(SOURCE_PATH, SOURCE_LABEL);
    const matrix = runMatrix(runtime);
    const pickers = runPickerMatrix(runtime);
    const result = report(matrix, pickers, SOURCE_LABEL);
    process.stdout.write(result.text);
    process.exitCode = result.exitCode;
} catch (error) {
    process.stderr.write(`calendar grid regression check could not run: ${error.message}\n`);
    process.exitCode = 1;
}
