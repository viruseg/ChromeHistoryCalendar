'use strict';

/**
 * Spacing the infobar shows before any date has been picked. Held in one place so the
 * initial render and the empty-selection branch of the update cannot drift apart.
 * @type {string[]}
 */
const EMPTY_INFOBAR = ['\u00A0', '\u00A0', '?', '\u00A0'];

const LEFT_ARROW = '\u25C0';
const RIGHT_ARROW = '\u25B6';

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
 * Calendar widget, rendered entirely from its private `#root` wrapper: the markup carries
 * no `id` attributes and no document-level query is ever issued, so several instances can
 * live on one page without colliding.
 *
 * Inline mode only for now — an `<input>` target throws. Every method below is
 * synchronous; nothing is deferred, because callers observe the DOM the moment a call
 * returns.
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
    #host;
    /** @type {HTMLElement} the wrapper this instance owns, rebuilt on every render */
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
     * }} options `target` is an element or a `#id` selector; `view.month` is 0-based;
     *     `locale` falls back to the Russian Monday-first defaults.
     * @throws {TypeError} when the target is missing, is not a div, or is an input
     *     (popup mode is not implemented yet)
     */
    constructor(options) {
        const { target, view, weekStartsOnMonday, showInfoBar, locale, onSelect, onFocus } = options;

        this.#host = Calendar.#resolveTarget(target);
        this.#weekStartsOnMonday = weekStartsOnMonday;
        this.#showInfoBar = showInfoBar;
        this.#onSelect = onSelect ?? null;
        this.#onFocus = onFocus ?? null;
        this.#locale = Calendar.#mergeLocale(locale);
        this.#selected = { year: 0, month: 0, day: 0 };
        this.#year = view.year;
        this.#month = view.month;
        this.#pickup = { year: view.year, month: view.month };

        this.#render();
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
     * Replaces the language and re-draws. `weekStartsOnMonday` rides along with the
     * arrays because the extension only ever settles the week start here, never in the
     * constructor.
     *
     * @param {{
     *     months: {nominative: string[], genitive: string[]},
     *     weekdays: {short: string[], full: string[]},
     *     completeText?: string,
     *     weekStartsOnMonday?: boolean
     * }} locale omitting a field keeps the current value for it
     */
    setLocale(locale) {
        this.#locale = Calendar.#mergeLocale(locale);
        this.#weekStartsOnMonday = locale.weekStartsOnMonday ?? this.#weekStartsOnMonday;
        this.#render();
    }

    /**
     * @returns {string} the id of the target element the caller named, which the
     *     surrounding page still uses to address its own container
     */
    getTargetId() {
        return this.#host.id;
    }

    /** Detaches the calendar's markup from the target and releases the instance. */
    destroy() {
        if (!this.#root) {
            return;
        }
        this.#root.remove();
        this.#root = null;
    }

    /**
     * @param {HTMLElement|string} target element, or a `#id` selector for one
     * @returns {HTMLElement} the resolved element
     * @throws {TypeError} when nothing matches, when the element is an input (popup mode
     *     is not implemented yet) or when it is neither an input nor a div
     */
    static #resolveTarget(target) {
        const element = typeof target === 'string' ? document.querySelector(target) : target;

        if (!element) {
            throw new TypeError('calendar target not found');
        }
        if (element.tagName === 'INPUT') {
            throw new TypeError('popup target not implemented');
        }
        if (element.tagName !== 'DIV') {
            throw new TypeError('calendar target must be a div, got ' + element.tagName);
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
     * @param {Object|undefined} locale partial locale; absent fields keep the built-in
     *     Russian Monday-first defaults rather than falling back to `Intl`, whose output
     *     would differ from them in the very first render
     * @returns {{months: Object, weekdays: Object, completeText: string}} a complete locale
     */
    static #mergeLocale(locale) {
        return {
            months: locale?.months ?? Calendar.DEFAULT_MONTHS,
            weekdays: locale?.weekdays ?? Calendar.DEFAULT_WEEKDAYS,
            completeText: locale?.completeText ?? Calendar.DEFAULT_COMPLETE_TEXT
        };
    }

    /**
     * Rebuilds the whole calendar and swaps it into the target in one step, the way the
     * legacy code emptied its container before each draw. Replacing the wrapper itself
     * rather than its contents keeps stale nodes from the previous render out of the
     * queries below.
     */
    #render() {
        this.#root = this.#buildCalendar();
        this.#host.replaceChildren(this.#root);

        this.#updateInfobar();

        /* Without the infobar the table would sit under a 15.7em gap nothing occupies. */
        if (!this.#showInfoBar) {
            this.#root.querySelector('table').style.marginTop = '0';
        }
    }

    /**
     * @returns {HTMLElement} the wrapper holding infobar, table and the two pickers, in
     *     that order
     */
    #buildCalendar() {
        const calendar = document.createElement('div');
        calendar.className = 'cw___calendar';

        calendar.append(
            this.#buildInfobar(),
            this.#buildTable(),
            this.#buildMonthPicker(),
            this.#buildYearPicker()
        );

        return calendar;
    }

    /**
     * @returns {HTMLElement} the four-field bar above the grid
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
                        current.getFullYear() + '.' + current.getMonth() + '.' + current.getDate()
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
     * @param {Date} start first day of the drawn month
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

    /**
     * @param {string} glyph arrow to draw
     * @returns {HTMLTableCellElement}
     */
    #buildArrowCell(glyph) {
        const cell = document.createElement('th');
        const button = document.createElement('div');
        button.className = 'cw___buttonJump';
        button.textContent = glyph;
        cell.appendChild(button);

        return cell;
    }

    /**
     * @param {Date} start first day of the drawn month
     * @returns {HTMLTableCellElement} the month-and-year caption, spanning the five
     *     weekday columns between the arrows
     */
    #buildCaptionCell(start) {
        const cell = document.createElement('th');
        cell.className = 'cw___monthChange';
        cell.setAttribute('colspan', '5');
        cell.textContent = this.#locale.months.nominative[start.getMonth()]
            + ' ' + start.getFullYear();

        return cell;
    }

    /**
     * @returns {HTMLElement} the hidden month picker
     */
    #buildMonthPicker() {
        const picker = document.createElement('div');
        picker.className = 'cw___picker cw___picker--month';
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
     * @returns {HTMLElement} the hidden year picker
     */
    #buildYearPicker() {
        const picker = document.createElement('div');
        picker.className = 'cw___picker cw___picker--year';
        picker.appendChild(this.#buildPickerControl('cw___captionYear'));

        /* 2000..2017: the range the picker opens on before it has been told which year to
           centre on, which is the state every render starts from. */
        for (let year = 2000; year <= 2017; year++) {
            picker.appendChild(
                this.#buildPickerButton('cw___yearButton', 'data-year', year - 2000, String(year))
            );
        }

        return picker;
    }

    /**
     * @param {string} captionClass identity class of the caption, which differs between
     *     the two pickers
     * @returns {HTMLElement} the arrows-and-caption row every picker opens with
     */
    #buildPickerControl(captionClass) {
        const control = document.createElement('div');
        control.className = 'cw___monthControl';

        const caption = document.createElement('div');
        caption.className = 'cw___buttonCentr ' + captionClass;
        caption.textContent = '-';

        control.append(
            this.#buildPickerArrow(LEFT_ARROW),
            caption,
            this.#buildPickerArrow(RIGHT_ARROW)
        );

        return control;
    }

    /**
     * @param {string} glyph arrow to draw
     * @returns {HTMLElement}
     */
    #buildPickerArrow(glyph) {
        const arrow = document.createElement('div');
        arrow.className = 'cw___buttonJump cw___buttonJump2';
        arrow.textContent = glyph;

        return arrow;
    }

    /**
     * @param {string} className
     * @param {string} attribute numeric attribute carrying the button's own value
     * @param {number} value
     * @param {string} label text the button shows
     * @returns {HTMLElement}
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
        const wanted = this.#selected.year + '.' + this.#selected.month + '.' + this.#selected.day;

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