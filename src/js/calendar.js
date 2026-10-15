'use strict';

/**
 * Spacing the infobar shows before any date has been picked. Held in one place so the
 * initial render and the empty-selection branch of the update cannot drift apart.
 * @type {string[]}
 */
const EMPTY_INFOBAR = ['\u00A0', '\u00A0', '?', '\u00A0'];

const LEFT_ARROW = '\u25C0';
const RIGHT_ARROW = '\u25B6';

/** Single class that shows a picker; the closed state is the stylesheet's `display: none`. */
const PICKER_OPEN = 'cw___picker--open';

/* How the year picker's range is laid out around its pivot: the caption reads
   `pivot − 7 … pivot + 10`, so the pivot itself sits on the eighth button. */
const PICKER_YEARS_BEFORE = 7;
const PICKER_YEARS_AFTER = 10;

/** Year buttons in the year picker, and therefore the step its arrows move by. */
const YEAR_BUTTON_COUNT = PICKER_YEARS_BEFORE + PICKER_YEARS_AFTER + 1;

/**
 * Two `Date` objects denote the same day when their calendar fields agree. Compared this
 * way rather than by timestamp so a cell carrying a shifted day number — the spill cells
 * of the bracketing rows — still matches the day it actually displays.
 *
 * @param {Date} left
 * @param {Date} right
 * @returns {boolean}
 */
function isSameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

/**
 * @typedef {{element: EventTarget, type: string, handler: EventListener}} BoundListener
 * one entry per `addEventListener` call this instance made, so `destroy()` can undo them
 */

/**
 * Calendar widget, rendered entirely from its private `#root` wrapper: the markup carries
 * no `id` attributes and no document-level query is ever issued, so several instances can
 * live on one page without colliding.
 *
 * A `div` target renders inline. An `input` target renders a date picker: the calendar is
 * mounted in a wrapper this instance owns, parked to the right of the input and shown when
 * the input takes focus. Every method below is synchronous; nothing is deferred, because
 * callers observe the DOM the moment a call returns.
 */
class Calendar {
    static {
        /** @type {{nominative: string[], genitive: string[]}} */
        Calendar.DEFAULT_MONTHS = {
            nominative: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
            genitive: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
        };

        /** @type {{short: string[], full: string[]}} both arrays Monday-first */
        Calendar.DEFAULT_WEEKDAYS = {
            short: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
            full: ['понедельник', 'вторник', 'среда', 'четверг', 'пятница',
                'суббота', 'воскресенье']
        };

        /** @type {string} */
        Calendar.DEFAULT_COMPLETE_TEXT = 'готово';
    }

    /** @type {HTMLElement} the target the caller named; its own id is left alone */
    #target;
    /** @type {HTMLDivElement|null} popup wrapper this instance owns, null in inline mode */
    #wrapper;
    /** @type {HTMLDivElement|null} the calendar markup, rebuilt on every render */
    #root;
    /** @type {number} year currently drawn */
    #year;
    /** @type {number} month currently drawn, 0-based */
    #month;
    /** @type {{year: number, month: number, day: number}} */
    #selected;
    /** @type {{months: {nominative: string[], genitive: string[]}, weekdays: {short: string[], full: string[]}, completeText: string}} */
    #locale;
    /** @type {boolean} */
    #weekStartsOnMonday;
    /** @type {boolean} */
    #showInfoBar;
    /** @type {((selected: {year: number, month: number, day: number}) => void)|null} */
    #onSelect;
    /** @type {(() => void)|null} */
    #onFocus;
    /** @type {{year: number, month: number}} month and year the pickers navigate from */
    #pickup;
    /** @type {BoundListener[]} */
    #listeners = [];

    /**
     * @param {{
     *     target: HTMLElement|string,
     *     view: {year: number, month: number},
     *     weekStartsOnMonday: boolean,
     *     showInfoBar: boolean,
     *     locale?: {
     *         months: {nominative: string[], genitive: string[]},
     *         weekdays: {short: string[], full: string[]},
     *         completeText?: string
     *     },
     *     onSelect?: (selected: {year: number, month: number, day: number}) => void,
     *     onFocus?: () => void
     * }} options `target` is an element or a `#id` selector; a div renders inline, an
     *     input renders a popup; `view.month` is 0-based; `locale` falls back to the
     *     Russian Monday-first defaults.
     * @throws {TypeError} when the target is missing, or is neither a div nor an input
     */
    constructor(options) {
        const { target, view, weekStartsOnMonday, showInfoBar, locale, onSelect, onFocus } = options;

        this.#target = Calendar.#resolveTarget(target);
        this.#wrapper = this.#target.tagName === 'INPUT' ? this.#createWrapper() : null;
        this.#weekStartsOnMonday = weekStartsOnMonday;
        this.#showInfoBar = showInfoBar;
        this.#onSelect = onSelect ?? null;
        this.#onFocus = onFocus ?? null;
        this.#locale = Calendar.#mergeLocale(locale, Calendar.#defaults());
        this.#selected = { year: 0, month: 0, day: 0 };
        this.#year = view.year;
        this.#month = view.month;
        this.#pickup = { year: view.year, month: view.month };

        this.#render();
        this.#bindInputEvents();
    }

    /**
     * Selects a day, moves the drawn month onto it and reports the choice.
     *
     * All three arguments must satisfy `n % 1 === 0`; a single non-integer leaves the
     * calendar completely untouched and reports success anyway, which is what the legacy
     * API does and what its callers rely on to probe a value without committing to it.
     *
     * @param {number} year
     * @param {number} month 0-based
     * @param {number} day
     * @returns {true} always
     */
    setDateSelect(year, month, day) {
        /* Before the guard: the popup has to have caught up with the input even when the
           arguments turn out to be unusable. */
        this.#positionPopup();

        if (!Calendar.#isInteger(year) || !Calendar.#isInteger(month) || !Calendar.#isInteger(day)) {
            return true;
        }

        this.#selected = { year: year * 1, month: month * 1, day: day * 1 };
        this.#year = year;
        this.#month = month;
        this.#render();

        /* Fired after the re-render, not before: history.js queries on the strength of
           this callback and expects the calendar to already show the date it names. */
        if (this.#onSelect) {
            this.#onSelect({ ...this.#selected });
        }

        this.#updateInfobar();
        return true;
    }

    /**
     * Clears the selection. The grid is deliberately left as it is — only the highlight and
     * the infobar change — so callers can empty the value without losing the month the
     * user is browsing.
     *
     * @returns {true} always
     */
    resetDateSelect() {
        this.#selected = { year: 0, month: 0, day: 0 };
        this.#repaintSelected();
        this.#updateInfobar();
        return true;
    }

    /**
     * The selected day in the shape the history query needs.
     *
     * @returns {{year: string, month: string, day: string}} month and day zero-padded to
     *     two digits. With nothing selected this is `{year: '0', month: '01', day: '00'}`
     *     rather than an empty string, matching the legacy contract.
     */
    getDateSelect() {
        return {
            year: String(this.#selected.year),
            month: String(this.#selected.month + 1).padStart(2, '0'),
            day: String(this.#selected.day).padStart(2, '0')
        };
    }

    /**
     * Applies `locale` and re-draws. Every field is optional, and an absent one keeps the
     * value this instance already holds. `weekStartsOnMonday` rides along with the arrays
     * because the extension settles the week start only here, never in the constructor.
     *
     * @param {{
     *     months?: {nominative: string[], genitive: string[]},
     *     weekdays?: {short: string[], full: string[]},
     *     completeText?: string,
     *     weekStartsOnMonday?: boolean
     * }} locale
     */
    setLocale(locale) {
        this.#locale = Calendar.#mergeLocale(locale, this.#locale);
        this.#weekStartsOnMonday = locale?.weekStartsOnMonday ?? this.#weekStartsOnMonday;
        this.#render();
    }

    /**
     * @returns {string} the id of the target element the caller named, which the
     *     surrounding page still uses to address its own container
     */
    getTargetId() {
        return this.#target.id;
    }

    /** Detaches every listener, the popup wrapper and the markup, and releases the instance. */
    destroy() {
        for (const { element, type, handler } of this.#listeners) {
            element.removeEventListener(type, handler);
        }
        this.#listeners.length = 0;

        this.#root?.remove();
        this.#root = null;
        this.#wrapper?.remove();
        this.#wrapper = null;
    }

    /**
     * @param {HTMLElement|string} target element, or a `#id` selector for one
     * @returns {HTMLElement} the resolved element
     * @throws {TypeError} when nothing matches, or when the element is neither an input
     *     nor a div
     */
    static #resolveTarget(target) {
        const element = typeof target === 'string' ? document.querySelector(target) : target;

        if (!element) {
            throw new TypeError('calendar target not found');
        }
        if (element.tagName !== 'INPUT' && element.tagName !== 'DIV') {
            throw new TypeError(`calendar target must be a div or an input, got ${element.tagName}`);
        }

        return element;
    }

    /**
     * @param {number} value
     * @returns {boolean} whether the value is a whole number. Deliberately not
     *     `Number.isInteger`: numeric strings pass this test, which the legacy API allowed
     */
    static #isInteger(value) {
        return value % 1 === 0;
    }

    /**
     * @returns {{
     *     months: {nominative: string[], genitive: string[]},
     *     weekdays: {short: string[], full: string[]},
     *     completeText: string
     * }} the built-in Russian Monday-first locale. These are the constructor's starting
     *     point rather than `Intl`, whose output would differ from them in the very first
     *     render
     */
    static #defaults() {
        return {
            months: Calendar.DEFAULT_MONTHS,
            weekdays: Calendar.DEFAULT_WEEKDAYS,
            completeText: Calendar.DEFAULT_COMPLETE_TEXT
        };
    }

    /**
     * Merging against the caller's `base` rather than the static defaults is what keeps
     * `setLocale` internally consistent: omitted arrays would otherwise revert to Russian
     * while the week start kept its old value, assembling a mixed-language calendar out of
     * a single call.
     *
     * @param {{
     *     months?: {nominative: string[], genitive: string[]},
     *     weekdays?: {short: string[], full: string[]},
     *     completeText?: string
     * }} locale
     * @param {{
     *     months: {nominative: string[], genitive: string[]},
     *     weekdays: {short: string[], full: string[]},
     *     completeText: string
     * }} base complete locale the absent fields are taken from
     * @returns {{
     *     months: {nominative: string[], genitive: string[]},
     *     weekdays: {short: string[], full: string[]},
     *     completeText: string
     * }} a complete locale
     */
    static #mergeLocale(locale, base) {
        return {
            months: locale?.months ?? base.months,
            weekdays: locale?.weekdays ?? base.weekdays,
            completeText: locale?.completeText ?? base.completeText
        };
    }

    /**
     * @returns {HTMLDivElement} the popup wrapper. It carries `cw___absolute` beside its own
     *     identity class: that utility class is what positions it absolutely, and it must
     *     not also carry the root's `cw___calendar`, whose `position: relative` would then
     *     apply to the wrapper as well.
     */
    #createWrapper() {
        const wrapper = document.createElement('div');
        wrapper.className = 'cw___calendarHost cw___hide cw___absolute';
        document.body.appendChild(wrapper);

        return wrapper;
    }

    /** @returns {HTMLElement} the element the calendar is mounted into */
    #mountPoint() {
        return this.#wrapper ?? this.#target;
    }

    /**
     * @param {EventTarget} element node the handler goes on; kept in the ledger so that
     *     `destroy()` can take it off again
     * @param {string} type DOM event name
     * @param {EventListener} handler
     */
    #bind(element, type, handler) {
        element.addEventListener(type, handler);
        this.#listeners.push({ element, type, handler });
    }

    /**
     * Releases the handlers bound inside a root that is about to be discarded. Every render
     * builds a new root, so without this the ledger would grow by one dead entry per render.
     *
     * @param {HTMLDivElement|null} root the root being replaced
     */
    #unbindRoot(root) {
        if (!root) {
            return;
        }

        this.#listeners = this.#listeners.filter((entry) => {
            if (root.contains(entry.element)) {
                root.removeEventListener(entry.type, entry.handler);
                return false;
            }
            return true;
        });
    }

    /**
     * Wires the input and the document. Inline mode has none of this: an inline calendar is
     * always visible and owns no listener outside its own markup.
     */
    #bindInputEvents() {
        if (!this.#wrapper) {
            return;
        }

        this.#bind(this.#target, 'focusin', () => {
            this.#setVisible(true);
            if (this.#onFocus) {
                this.#onFocus();
            }
        });

        this.#bind(this.#target, 'keydown', () => this.#setVisible(false));

        /* Keeps a click inside the picker from reaching the page's own outside-click menu
           handling, the way the legacy `mousedown` stopPropagation on the wrapper did. */
        this.#bind(this.#wrapper, 'pointerdown', (event) => event.stopPropagation());

        /* Scoped to this instance on purpose. The legacy code hid every calendar on the
           page from a global body handler; only this instance's own markup is hidden here. */
        this.#bind(document, 'pointerdown', (event) => {
            if (!this.#root.contains(event.target)) {
                this.#setVisible(false);
            }
        });
    }

    /** @param {boolean} visible a no-op inline, where there is no wrapper to show */
    #setVisible(visible) {
        this.#wrapper?.classList.toggle('cw___hide', !visible);
    }

    /**
     * Parks the wrapper to the right of its input. Re-run on every render and at the head
     * of `setDateSelect()`, so the popup keeps up with an input that scrolled away.
     *
     * The width counts horizontal margins, because the legacy read it from jQuery's
     * `outerWidth(true)`; leaving them out moves the popup 36 px short on this page's
     * date buttons.
     */
    #positionPopup() {
        if (!this.#wrapper) {
            return;
        }

        const style = getComputedStyle(this.#target);
        const box = this.#target.getBoundingClientRect();

        const width = ['width', 'paddingLeft', 'paddingRight', 'borderLeftWidth',
            'borderRightWidth', 'marginLeft', 'marginRight']
            .reduce((sum, property) => sum + parseFloat(style[property]), 0);

        this.#wrapper.style.left = `${box.left + globalThis.scrollX + width + 1}px`;
        this.#wrapper.style.top = `${box.top + globalThis.scrollY}px`;
    }

    /**
     * Rebuilds the whole calendar and swaps it into its mount point in one step, the way the
     * legacy code emptied its container before each draw. Replacing the wrapper itself
     * rather than its contents keeps stale nodes from the previous render out of the
     * queries below — and with them the handlers bound on it.
     */
    #render() {
        this.#positionPopup();
        this.#unbindRoot(this.#root);

        this.#root = this.#buildCalendar();
        this.#mountPoint().replaceChildren(this.#root);

        this.#updateInfobar();

        /* Without the infobar the table would sit under a 15.7em gap nothing occupies. */
        if (!this.#showInfoBar) {
            this.#root.querySelector('table').style.marginTop = '0';
        }

        this.#bindEvents();
    }

    /**
     * One delegated handler for everything inside the calendar: the day cells alone are 42
     * per render, and binding each of them would cost more than resolving which one was
     * clicked. The arrows carry no class of their own — their identity is their position in
     * the header row and in each picker's control row — so they are matched positionally.
     */
    #bindEvents() {
        const root = this.#root;
        const header = root.querySelector('table tr');
        const monthControl = root.querySelector('.cw___picker--month .cw___monthControl');
        const yearControl = root.querySelector('.cw___picker--year .cw___monthControl');
        const complete = root.querySelector('.cw___buttonComplete');

        if (complete) {
            this.#bind(complete, 'click', () => this.#setVisible(false));
        }

        this.#bind(root, 'click', (event) => {
            const target = event.target;

            const dayCell = target.closest('.cw___active');
            if (dayCell) {
                this.#selectDay(dayCell);
                return;
            }

            const monthButton = target.closest('.cw___monthButton');
            if (monthButton) {
                this.#pickMonth(monthButton);
                return;
            }

            const yearButton = target.closest('.cw___yearButton');
            if (yearButton) {
                this.#pickYear(yearButton);
                return;
            }

            const caption = target.closest('.cw___captionMonth, .cw___captionYear, .cw___monthChange');
            if (caption) {
                if (caption.classList.contains('cw___monthChange')) {
                    this.#openMonthPicker();
                } else if (caption.classList.contains('cw___captionMonth')) {
                    this.#openYearPicker();
                } else {
                    this.#resetPickupToToday();
                }
                return;
            }

            const arrow = target.closest('.cw___buttonJump');
            if (arrow === header.children[0].firstElementChild) {
                this.#pageMonth(-1);
            } else if (arrow === header.children[2].firstElementChild) {
                this.#pageMonth(1);
            } else if (arrow === monthControl.children[0]) {
                this.#shiftPickupYear(-1);
            } else if (arrow === monthControl.children[2]) {
                this.#shiftPickupYear(1);
            } else if (arrow === yearControl.children[0]) {
                this.#shiftPickupYear(-YEAR_BUTTON_COUNT);
            } else if (arrow === yearControl.children[2]) {
                this.#shiftPickupYear(YEAR_BUTTON_COUNT);
            }
        });
    }

    /**
     * @returns {HTMLDivElement} the month overlay, the second-to-last child of the root
     */
    #monthPicker() {
        return this.#root.querySelector('.cw___picker--month');
    }

    /**
     * @returns {HTMLDivElement} the year overlay, the last child of the root
     */
    #yearPicker() {
        return this.#root.querySelector('.cw___picker--year');
    }

    /**
     * Redraws both pickers around `#pickup`: their captions, the year range they offer and
     * the marks for today and for the selected date. A button can end up carrying both
     * marks at once, which is what happens on the current date itself.
     */
    #updatePicker() {
        const pivot = this.#pickup.year;
        const now = new Date();

        this.#root.querySelector('.cw___captionMonth').textContent = String(pivot);
        this.#root.querySelector('.cw___captionYear').textContent =
            `${pivot - PICKER_YEARS_BEFORE} — ${pivot + PICKER_YEARS_AFTER}`;

        for (const button of this.#root.querySelectorAll('.cw___monthButton')) {
            const month = Number(button.getAttribute('data-month'));

            button.classList.remove('cw___selectedMonth', 'cw___now');
            if (pivot === this.#selected.year && month === this.#selected.month) {
                button.classList.add('cw___selectedMonth');
            }
            if (pivot === now.getFullYear() && month === now.getMonth()) {
                button.classList.add('cw___now');
            }
        }

        const first = pivot - PICKER_YEARS_BEFORE;
        this.#root.querySelectorAll('.cw___yearButton').forEach((button, index) => {
            const year = first + index;

            button.classList.remove('cw___selectedYear', 'cw___now');
            button.setAttribute('data-year', String(year));
            button.textContent = String(year);

            if (year === now.getFullYear()) {
                button.classList.add('cw___now');
            }
            if (year === this.#selected.year) {
                button.classList.add('cw___selectedYear');
            }
        });
    }

    /** Caption of the month picker: opens it, re-anchored on the month being drawn. */
    #openMonthPicker() {
        this.#normalizeIntegers();
        this.#pickup.year = this.#year;
        this.#pickup.month = this.#month;
        this.#updatePicker();
        this.#monthPicker().classList.add(PICKER_OPEN);
    }

    /**
     * Caption of the month picker, read as "pick a year instead": opens the year overlay,
     * which is drawn against whatever pivot the month overlay has reached so far.
     */
    #openYearPicker() {
        this.#yearPicker().classList.add(PICKER_OPEN);
    }

    /**
     * @param {HTMLElement} button month button, whose `data-month` is the month to draw
     */
    #pickMonth(button) {
        this.#pickup.month = Number(button.getAttribute('data-month'));
        this.#month = this.#pickup.month;
        this.#year = this.#pickup.year;
        this.#render();
    }

    /**
     * @param {HTMLElement} button year button, whose `data-year` is the year to draw
     */
    #pickYear(button) {
        this.#pickup.year = Number(button.getAttribute('data-year'));
        this.#year = this.#pickup.year;
        this.#updatePicker();
        this.#yearPicker().classList.remove(PICKER_OPEN);
    }

    /**
     * @param {number} by how many years the picker captions move; the year picker's arrows
     *     step by its whole width, so the range on screen changes wholesale
     */
    #shiftPickupYear(by) {
        this.#pickup.year += by;
        this.#updatePicker();
    }

    /** Caption of the year picker: jumps the range back to today, opening nothing. */
    #resetPickupToToday() {
        const now = new Date();
        this.#pickup.year = now.getFullYear();
        this.#pickup.month = now.getMonth();
        this.#updatePicker();
    }

    /**
     * @param {number} by -1 for the header's left arrow, 1 for its right
     */
    #pageMonth(by) {
        this.#normalizeIntegers();
        this.#month += by;

        if (by < 0) {
            if (this.#month === -1) {
                this.#month = 11;
                this.#year -= 1;
            }
        } else if (this.#month > 11) {
            const years = this.#month / 12 >> 0;
            this.#month %= 12;
            this.#year += years;
        }

        this.#render();
    }

    /**
     * @param {HTMLElement} cell day cell, whose `data-date` is the date it displays
     */
    #selectDay(cell) {
        const [year, month, day] = cell.getAttribute('data-date').split('.').map(Number);

        this.#selected.year = year;
        this.#selected.month = month;
        this.#selected.day = day;
        this.#repaintSelected();

        /* Strings on purpose: the legacy day click left the drawn month as the raw
           `data-date` parts and the paging handlers normalised them. */
        this.#year = String(year);
        this.#month = String(month);

        if (this.#onSelect) {
            this.#onSelect({ ...this.#selected });
        }

        this.#updateInfobar();
        this.#render();
    }

    /**
     * Forces every field that a click may have left as a string back to a number, so the
     * arithmetic in the paging and caption handlers can rely on it.
     */
    #normalizeIntegers() {
        this.#selected.year *= 1;
        this.#selected.month *= 1;
        this.#selected.day *= 1;
        this.#year *= 1;
        this.#month *= 1;
    }

    /**
     * @returns {HTMLDivElement} the calendar root. Child order is positional and load
     *     bearing: the pickers are the last two children, and the complete button only
     *     exists in a popup, between the table and them.
     */
    #buildCalendar() {
        const calendar = document.createElement('div');
        const popup = this.#wrapper !== null;
        calendar.className = popup ? 'cw___calendar cw___shadow' : 'cw___calendar';

        const children = [this.#buildInfobar(), this.#buildTable()];
        if (popup) {
            children.push(this.#buildCompleteButton());
        }
        children.push(this.#buildMonthPicker(), this.#buildYearPicker());
        calendar.append(...children);

        return calendar;
    }

    /**
     * @returns {HTMLDivElement} the four-field bar above the grid
     */
    #buildInfobar() {
        const infobar = document.createElement('div');
        infobar.className = this.#showInfoBar ? 'cw___infobar' : 'cw___infobar cw___hide';

        const fields = [
            'cw___infobarWeek',
            'cw___infobarMonth',
            'cw___infobarDay',
            'cw___infobarYear'
        ];

        fields.forEach((name, index) => {
            const field = document.createElement('div');
            field.className = name;
            field.textContent = EMPTY_INFOBAR[index];
            infobar.appendChild(field);
        });

        return infobar;
    }

    /**
     * @returns {HTMLDivElement} the button that closes a popup; it has no inline counterpart
     */
    #buildCompleteButton() {
        const button = document.createElement('div');
        button.className = 'cw___buttonComplete';
        button.textContent = this.#locale.completeText;

        return button;
    }

    /**
     * Draws the grid: an arrow header, a weekday header and exactly six week rows, 42 day
     * cells in all, whatever the month looks like.
     *
     * Every month is bracketed by one row of the previous month and one of the next, so the
     * grid never changes height. The two shifts below decide whether a bracketing row is
     * spelled out at all; they are what keep February 2010 — a 28-day month starting on a
     * Monday, the worst case — from pushing the grid to seven week rows and from marking a
     * whole extra week as belonging to the month.
     *
     * @returns {HTMLTableElement}
     */
    #buildTable() {
        const table = document.createElement('table');
        const start = new Date(this.#year, this.#month);

        table.appendChild(this.#buildArrowRow(start));

        /* Weekdays arrive Monday-first in both orientations; a Sunday-first grid needs
           Sunday moved to the front, which is a right rotation, not a left one. */
        const shortWeekdays = this.#locale.weekdays.short;
        const header = this.#weekStartsOnMonday
            ? shortWeekdays
            : [shortWeekdays.at(-1), ...shortWeekdays.slice(0, -1)];

        let dayCount = new Date(this.#year, this.#month + 1, 0).getDate();
        let dayNum = this.#weekStartsOnMonday ? 1 - (start.getDay() || 7) : -start.getDay();

        let backShifted = false;
        let forwardShifted = false;

        const now = new Date();
        const selectedDate = new Date(
            this.#selected.year,
            this.#selected.month,
            this.#selected.day
        );

        for (let row = 0; dayNum < dayCount; row++) {
            const line = document.createElement('tr');
            table.appendChild(line);

            for (let col = 0; col < 7; col++) {
                const cell = document.createElement('td');

                if (row === 0) {
                    cell.textContent = header[col];
                } else {
                    /* The first cell of the first day row would otherwise land on day 0 and
                       read as the last day of the previous month, leaving that week one
                       cell short of a full week of spill. */
                    if (!backShifted && dayNum === 0 && row === 1 && col === 0) {
                        dayNum -= 7;
                        backShifted = true;
                    }

                    dayNum++;

                    const current = new Date(this.#year, this.#month, dayNum);
                    const classes = [];

                    if (!forwardShifted && dayNum > 0 && dayNum <= dayCount) {
                        classes.push('cw___day');
                    }

                    /* Compared by calendar field, not by `dayNum`: after the forward shift
                       the row underneath carries the next month's days 1..7, and today
                       still has to light up when it is one of them. */
                    if (isSameDay(current, now)) {
                        classes.push('cw___now');
                    }
                    if (isSameDay(current, selectedDate)) {
                        classes.push('cw___selected');
                    }
                    classes.push('cw___active');

                    cell.className = classes.join(' ');

                    /* `dayNum` is the raw counter, not a date: it reads 0, 31 or -6 at the
                       edges, so the cell stores the date it actually displays. */
                    cell.setAttribute(
                        'data-date',
                        `${current.getFullYear()}.${current.getMonth()}.${current.getDate()}`
                    );
                    cell.textContent = String(current.getDate());
                }

                line.appendChild(cell);
            }

            /* After five week rows a short month would otherwise end the loop and the grid
               would lose its fixed height. One extra row of spill keeps it at six. */
            if (row === 5 && !forwardShifted && dayNum >= dayCount) {
                dayCount += 7;
                forwardShifted = true;
            }
        }

        return table;
    }

    /**
     * @param {Date} start
     * @returns {HTMLTableRowElement} the row carrying the paging arrows and the caption
     */
    #buildArrowRow(start) {
        const line = document.createElement('tr');

        line.append(
            this.#buildArrowCell(LEFT_ARROW),
            this.#buildCaptionCell(start),
            this.#buildArrowCell(RIGHT_ARROW)
        );

        return line;
    }

    /** @returns {HTMLTableCellElement} the header cell wrapping one paging arrow */
    #buildArrowCell(glyph) {
        const cell = document.createElement('th');
        const button = document.createElement('div');
        button.className = 'cw___buttonJump';
        button.textContent = glyph;
        cell.appendChild(button);

        return cell;
    }

    /**
     * @param {Date} start
     * @returns {HTMLTableCellElement} the month-and-year caption, spanning the five
     *     weekday columns between the arrows
     */
    #buildCaptionCell(start) {
        const cell = document.createElement('th');
        cell.className = 'cw___monthChange';
        cell.setAttribute('colspan', '5');
        cell.textContent = `${this.#locale.months.nominative[start.getMonth()]} ${start.getFullYear()}`;

        return cell;
    }

    /**
     * @returns {HTMLDivElement} the hidden month picker
     */
    #buildMonthPicker() {
        const picker = this.#createPicker('cw___picker--month');
        picker.appendChild(this.#buildPickerControl('cw___captionMonth'));

        /* Zig-zag, not 0..11: the grid is two columns of six, so DOM order fills the
           first column top to bottom and only then the second. */
        for (let i = 0; i <= 5; i++) {
            picker.append(
                this.#buildPickerButton('cw___monthButton', 'data-month', i,
                    this.#locale.months.nominative[i]),
                this.#buildPickerButton('cw___monthButton', 'data-month', i + 6,
                    this.#locale.months.nominative[i + 6])
            );
        }

        return picker;
    }

    /**
     * @returns {HTMLDivElement} the hidden year picker
     */
    #buildYearPicker() {
        const picker = this.#createPicker('cw___picker--year');
        picker.appendChild(this.#buildPickerControl('cw___captionYear'));

        /* 2000..2017: the range the picker opens on before it has been told which year to
           centre on, which is the state every render starts from. */
        for (let year = 2000; year < 2000 + YEAR_BUTTON_COUNT; year++) {
            picker.appendChild(
                this.#buildPickerButton('cw___yearButton', 'data-year', year - 2000, String(year))
            );
        }

        return picker;
    }

    /**
     * @param {string} variant
     * @returns {HTMLDivElement} the picker shell. A popup's pickers are offset upwards, to
     *     clear the complete button that sits below the grid.
     */
    #createPicker(variant) {
        const picker = document.createElement('div');
        picker.className = this.#wrapper
            ? `cw___picker ${variant} cw___picker--offset`
            : `cw___picker ${variant}`;

        return picker;
    }

    /**
     * @param {string} captionClass identity class of the caption; it differs between the
     *     two pickers, which is the only thing telling the two overlays apart
     * @returns {HTMLDivElement} the arrows-and-caption row every picker opens with
     */
    #buildPickerControl(captionClass) {
        const control = document.createElement('div');
        control.className = 'cw___monthControl';

        const caption = document.createElement('div');
        caption.className = `cw___buttonCentr ${captionClass}`;
        caption.textContent = '-';

        control.append(
            this.#buildPickerArrow(LEFT_ARROW),
            caption,
            this.#buildPickerArrow(RIGHT_ARROW)
        );

        return control;
    }

    /** @returns {HTMLDivElement} one of a picker's paging arrows */
    #buildPickerArrow(glyph) {
        const arrow = document.createElement('div');
        arrow.className = 'cw___buttonJump cw___buttonJump2';
        arrow.textContent = glyph;

        return arrow;
    }

    /**
     * @param {string} className
     * @param {string} attribute name of the attribute carrying the button's own value; it
     *     is what a click reads back, so it is the picker's addressing scheme
     * @param {number|string} value
     * @param {string} label
     * @returns {HTMLDivElement}
     */
    #buildPickerButton(className, attribute, value, label) {
        const button = document.createElement('div');
        button.className = className;
        button.setAttribute(attribute, String(value));
        button.textContent = label;

        return button;
    }

    /** Moves the `cw___selected` mark onto whichever cell holds the current selection. */
    #repaintSelected() {
        const wanted = `${this.#selected.year}.${this.#selected.month}.${this.#selected.day}`;

        for (const cell of this.#root.querySelectorAll('.cw___active')) {
            cell.classList.toggle('cw___selected', cell.getAttribute('data-date') === wanted);
        }
    }

    /**
     * Fills the infobar from the selection, or blanks it when nothing is selected. The
     * field order is week, month, day, year, matching the mark-up order.
     */
    #updateInfobar() {
        const infobar = this.#root.querySelector('.cw___infobar');
        const fields = infobar.children;

        if (this.#selected.year === 0) {
            for (let index = 0; index < fields.length; index++) {
                fields[index].textContent = EMPTY_INFOBAR[index];
            }
            return;
        }

        const date = new Date(this.#selected.year, this.#selected.month, this.#selected.day);

        fields[0].textContent = this.#locale.weekdays.full[(date.getDay() || 7) - 1];
        fields[1].textContent = this.#locale.months.genitive[this.#selected.month];
        fields[2].textContent = String(this.#selected.day);
        fields[3].textContent = String(this.#selected.year);
    }
}

globalThis.Calendar = Calendar;
