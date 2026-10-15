function createCalendarObj(id, year, month, firstDayMondey, showInfoBar, onSelect, onFocus) {

    var calendarObj = {

        calendarVar : {
            id: '',
            year: 0, //год для отрисовки календаря
            month: 0, //месяц для отрисовки
            firstDayMondey: true,
            showInfoBar: false,

            tag: '',
            inputId: '',

            monthName: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
            monthName2: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
            weekDayMondayFull: ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'],
            weekDayMonday: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
            weekDay: undefined,
            completeText: 'готово',

            //Активное число, меняется после клика по любому числу
            selected: {
                year: 0,
                month: 0,
                day: 0
            },
            onSelect: undefined, //После клика по дате
            onFocus: undefined, //Когда фокус получает инпут

            leftButton: undefined,
            rightButton: undefined,
            monthChange: undefined,
            blockMonth: undefined,
            blockYear: undefined,
            captionMonth: undefined,
            captionYear: undefined,

            //Месяц и год для навигации по их выбору
            tempPickup: {
                year: 0,
                month: 0
            }
        },

        createPickupMonthYear: function() {
            var calendarObj = $( '#' + this.calendarVar.id + ' #cw___calendarWin');
            var str2 = '';
            if ( this.calendarVar.tag == 'input' ) {
                str2 = 'cw___blockMonthMargin';
            }
            //Создание блока с выбором месяцев
            var str =  '<div id="cw___blockMonth" class="cw___blockMonth ' + str2 + '">\
                            <div class="cw___monthControl">\
                                <div id="cw___blockMonthLeft" class="cw___buttonJump cw___buttonJump2">\u25C0</div>\
                                <div id="cw___captionMonth" class="cw___buttonCentr">-</div>\
                                <div id="cw___blockMonthRight" class="cw___buttonJump cw___buttonJump2">\u25B6</div>\
                            </div>\
                        </div>';
            calendarObj.append(str);
            this.calendarVar.blockMonth = $( '#' + this.calendarVar.id + ' #cw___blockMonth' );
            this.calendarVar.captionMonth = $( '#' + this.calendarVar.id + ' #cw___captionMonth' );
            //Создание кнопок с месяцами
            for (var i = 0; i <= 5; i++) {
                str = '<div class="cw___monthButton" monthnum="' + i + '">' + this.calendarVar.monthName[i] + '</div>';
                str += '<div class="cw___monthButton" monthnum="' + (i + 6) + '">' + this.calendarVar.monthName[i+6] + '</div>';
                this.calendarVar.blockMonth.append(str);
            }

            //Создание блока с выбором года
            str =  '<div id="cw___blockYear" class="cw___blockMonth ' + str2 + '">\
                            <div class="cw___monthControl">\
                                <div id="cw___blockYearLeft" class="cw___buttonJump cw___buttonJump2">\u25C0</div>\
                                <div id="cw___captionYear" class="cw___buttonCentr">-</div>\
                                <div id="cw___blockYearRight" class="cw___buttonJump cw___buttonJump2">\u25B6</div>\
                            </div>\
                        </div>';
            calendarObj.append(str);
            this.calendarVar.blockYear = $( '#' + this.calendarVar.id + ' #cw___blockYear' );
            this.calendarVar.captionYear = $( '#' + this.calendarVar.id + ' #cw___captionYear' );
            //Создание кнопок с годами
            for (var j = 0; j <= 17; j++) {
                str = '<div class="cw___yearButton" yearnum="' + j + '">' + (2000 + j) + '</div>';
                this.calendarVar.blockYear.append(str);
            }
        },

        updatePickupControl: function() {
            //Обновить заголовки
            this.calendarVar.captionMonth.text(this.calendarVar.tempPickup.year);
            this.calendarVar.captionYear.text( (+this.calendarVar.tempPickup.year - 7) + ' — ' + (+this.calendarVar.tempPickup.year + 10) );
            //Отметить выделенный месяц
            $( '#' + this.calendarVar.id + ' .cw___monthButton').removeClass('cw___selectedMonth cw___now');
            if (this.calendarVar.tempPickup.year == this.calendarVar.selected.year) {
                $( '#' + this.calendarVar.id + ' .cw___monthButton[monthnum=' + this.calendarVar.selected.month + ']').addClass('cw___selectedMonth');
            }
            //Отметить месяц сегодняшней даты
            var now = new Date;
            if (this.calendarVar.tempPickup.year == now.getFullYear()) {
                $( '#' + this.calendarVar.id + ' .cw___monthButton[monthnum=' + now.getMonth() + ']').addClass('cw___now');
            }
            //Поменять текст с годами на кнопках
            var i = this.calendarVar.tempPickup.year - 7;
            $( '#' + this.calendarVar.id + ' .cw___yearButton').removeClass('cw___selectedYear cw___now').attr('yearnum', i).each(function(i) {
                var j = $(this).text(i).attr('yearnum');
                $(this).text(i).attr('yearnum', +j + i).text(+j + i);
            });
            //Отметить год сегодняшней даты
            $( '#' + this.calendarVar.id + ' .cw___yearButton[yearnum=' + now.getFullYear() + ']').addClass('cw___now');
            //Отметить выделенный год
            $( '#' + this.calendarVar.id + ' .cw___yearButton[yearnum=' + this.calendarVar.selected.year + ']').addClass('cw___selectedYear');
        },

        createControlButtonsEvent: function() {
            var obj = this;

            //Клик по Выбор месяца
            this.calendarVar.monthChange = $( '#' + this.calendarVar.id + ' #cw___monthChange' );
            this.calendarVar.monthChange.click(obj, function() {
                obj.normalizeInteger();
                obj.calendarVar.tempPickup.year = obj.calendarVar.year;
                obj.calendarVar.tempPickup.month = obj.calendarVar.month;
                obj.updatePickupControl();
                obj.calendarVar.blockMonth.show();
            });

            //Клик по Месяцу
            $( '#' + this.calendarVar.id + ' .cw___monthButton').click(obj, function() {
                obj.calendarVar.tempPickup.month = $(this).attr('monthnum');
                obj.calendarVar.month = +obj.calendarVar.tempPickup.month;
                obj.calendarVar.year = obj.calendarVar.tempPickup.year;
                obj.createCalendar(obj.calendarVar.id, obj.calendarVar.year, obj.calendarVar.month, obj.calendarVar.firstDayMondey, obj.calendarVar.showInfoBar);
            });

            //Клик по Листать год влево
            $( '#' + this.calendarVar.id + ' #cw___blockMonthLeft').click(obj, function() {
                obj.calendarVar.tempPickup.year--;
                obj.updatePickupControl();
            });

            //Клик по Листать год вправо
            $( '#' + this.calendarVar.id + ' #cw___blockMonthRight').click(obj, function() {
                obj.calendarVar.tempPickup.year++;
                obj.updatePickupControl();
            });

            //Клик по Выбор года
            this.calendarVar.captionMonth.click(obj, function() {
                obj.calendarVar.blockYear.show();
            });

            //Клик по Году
            $( '#' + this.calendarVar.id + ' .cw___yearButton').click(obj, function() {
                obj.calendarVar.tempPickup.year = $(this).attr('yearnum');
                obj.calendarVar.year = +obj.calendarVar.tempPickup.year;
                obj.updatePickupControl();
                obj.calendarVar.blockYear.hide();
            });

            //Клик по Листать года влево
            $( '#' + this.calendarVar.id + ' #cw___blockYearLeft').click(obj, function() {
                obj.calendarVar.tempPickup.year -= 18;
                obj.updatePickupControl();
            });

            //Клик по Листать года вправо
            $( '#' + this.calendarVar.id + ' #cw___blockYearRight').click(obj, function() {
                obj.calendarVar.tempPickup.year += 18;
                obj.updatePickupControl();
            });

            //Клик по Выбор года
            this.calendarVar.captionYear.click(obj, function() {
                var now = new Date;
                obj.calendarVar.tempPickup.year = now.getFullYear();
                obj.calendarVar.tempPickup.month = now.getMonth();
                obj.updatePickupControl();
            });

            //Клик по Листать влево
            this.calendarVar.leftButton = $( '#' + this.calendarVar.id + ' #cw___calendarLeft' );
            this.calendarVar.leftButton.click(obj, function() {
                obj.normalizeInteger();
                obj.calendarVar.month = obj.calendarVar.month - 1;
                if (obj.calendarVar.month === -1) {
                    obj.calendarVar.month = 11;
                    obj.calendarVar.year--;
                }
                obj.createCalendar(obj.calendarVar.id, obj.calendarVar.year, obj.calendarVar.month, obj.calendarVar.firstDayMondey, obj.calendarVar.showInfoBar);
            });

            //Клик по Листать вправо
            this.calendarVar.rightButton = $( '#' + this.calendarVar.id + ' #cw___calendarRight' );
            this.calendarVar.rightButton.click(obj, function() {
                obj.normalizeInteger();
                obj.calendarVar.month = obj.calendarVar.month + 1;
                if (obj.calendarVar.month > 11) {
                    var mod = obj.calendarVar.month % 12;
                    var int = obj.calendarVar.month/12 >> 0;
                    obj.calendarVar.month = mod;
                    obj.calendarVar.year += int;
                }
                obj.createCalendar(obj.calendarVar.id, obj.calendarVar.year, obj.calendarVar.month, obj.calendarVar.firstDayMondey, obj.calendarVar.showInfoBar);
            });

            //Клик по любому числу
            $( '#' + this.calendarVar.id + ' .cw___active' ).click(obj, function() {
                var arrDate = $( this ).attr('d');
                arrDate = arrDate.split('.');
                obj.calendarVar.selected.year = arrDate[0]*1;
                obj.calendarVar.selected.month = arrDate[1]*1;
                obj.calendarVar.selected.day = arrDate[2]*1;
                $( '#' + obj.calendarVar.id + ' .cw___active' ).removeClass('cw___selected');
                $( this ).addClass('cw___selected');

                obj.calendarVar.year = arrDate[0];
                obj.calendarVar.month = arrDate[1];

                obj.onSelect();
                obj.updateInfobar();
                obj.createCalendar(obj.calendarVar.id, obj.calendarVar.year, obj.calendarVar.month, obj.calendarVar.firstDayMondey, obj.calendarVar.showInfoBar);
            });

            //Клик по кнопке Готово
            $( '#' + this.calendarVar.id + ' #cw___buttonComplete' ).click(obj, function() {
                $( '#' + obj.calendarVar.id ).hide();
            })
        },

        createCalendar: function(id, year, month, firstDayMondey, showInfoBar) {
            var monthName = this.calendarVar.monthName;
            var date = new Date(year, month);
            var now = new Date;
            var dayCount = (new Date(year, month + 1, 0)).getDate();

            if (firstDayMondey) {
                var weekDay = this.calendarVar.weekDayMonday;
                var dayNum = 1 - (date.getDay() == 0 ? 7 : date.getDay());
            } else {
                var weekDay = this.calendarVar.weekDayMonday.slice(0);
                var str = weekDay.pop();
                weekDay.unshift(str);

                var dayNum = 0 - date.getDay();
            }

            this.fixCSS();

            var parent = document.getElementById(id);
            parent.innerHTML = "";

            //Оболочка для календаря
            var bodyCW = document.createElement('div');
            bodyCW.id = 'cw___calendarWin';
            if ( this.calendarVar.tag == 'input' ) {
                bodyCW.className = 'cw___shadow';
            }

            //Infobar
            var infobar = document.createElement('div');
            infobar.id = 'cw___infobar';
            if ( !showInfoBar ) { infobar.className = 'cw___hide' }
            bodyCW.appendChild(infobar);

            //Заполнение инфобара
            var infobarWeek = document.createElement('div');
            infobarWeek.id = 'cw___infobarWeek';
            infobarWeek.innerHTML ='&nbsp;'
            infobar.appendChild(infobarWeek);


            var infobarMonth = document.createElement('div');
            infobarMonth.id = 'cw___infobarMonth';
            infobarMonth.innerHTML ='&nbsp;'
            infobar.appendChild(infobarMonth);

            var infobarDay = document.createElement('div');
            infobarDay.id = 'cw___infobarDay';
            infobarDay.innerHTML ='?'
            infobar.appendChild(infobarDay);

            var infobarYear = document.createElement('div');
            infobarYear.id = 'cw___infobarYear';
            infobarYear.innerHTML ='&nbsp;'
            infobar.appendChild(infobarYear);

            //Таблица с календарём
            var table = document.createElement('table');

            /* первая строка шапки календаря */
            var tr = document.createElement('tr');

            // листать влево
            var button = document.createElement("div");
            button.id = 'cw___calendarLeft';
            button.className = 'cw___buttonJump';
            button.appendChild(document.createTextNode('\u25C0'));
            var elem = document.createElement("th");
            elem.appendChild(button);
            tr.appendChild(elem);

            // месяц год
            var cell = monthName[date.getMonth()] + ' ' + date.getFullYear();
            elem = document.createElement('th');
            elem.id = 'cw___monthChange';
            elem.setAttribute('colspan', '5');
            elem.appendChild(document.createTextNode(cell));
            tr.appendChild(elem);

            // листать вправо
            button = document.createElement("div");
            button.id = 'cw___calendarRight';
            button.className = 'cw___buttonJump';
            button.appendChild(document.createTextNode('\u25B6'));
            var elem = document.createElement("th");
            elem.appendChild(button);
            tr.appendChild(elem);

            table.appendChild(tr);

            var oneBackShift = false;
            var oneForwardShift = false;
            /* вторая строка шапки и тело календаря */
            for (var row = 0; dayNum < dayCount; row++) { // создавать строки, если в них есть хоть один день. Актуально для некоторых февралей, например 2010г.
                var tr = document.createElement('tr');
                table.appendChild(tr);

                for (var col = 0; col < 7; col++) {  // заполняем строку днями
                    if (row == 0) {
                        // заполнение шапки календаря
                        elem = document.createElement('td');
                        cell = weekDay[col];
                    } else {
                        // заполнение тела календаря
                        if ( oneBackShift==false && dayNum==0 && row==1 && col==0) {
                            dayNum -= 7;
                            oneBackShift = true;
                        }

                        dayNum++;

                        elem = document.createElement('td');

                        //Ячейки с числами текущего месяца
                        if (oneForwardShift==false && (dayNum > 0) && (dayNum <= dayCount)) {
                            elem.className = 'cw___day';
                            cell = dayNum;
                        }

                        //Подсветка текущей даты
                        if ( year == now.getFullYear() && month == now.getMonth() && dayNum == now.getDate() ) {
                            elem.className += ' cw___now';
                        }

                        //Подсветка выделенной даты
                        var dateSel = new Date(this.calendarVar.selected.year, this.calendarVar.selected.month, this.calendarVar.selected.day);
                        var dateCurrent = new Date(year, month, dayNum);
                        if ( dateCurrent.getFullYear() == dateSel.getFullYear() && dateCurrent.getMonth() == dateSel.getMonth() && dateCurrent.getDate() == dateSel.getDate() ) {
                            elem.className += ' cw___selected';
                        }

                        //Ячейки с числами любого месяца
                        elem.className += ' cw___active';

                        //Запись даты ячейки в атрибуты
                        elem.setAttribute('d', year + '.' + month + '.' + dayNum);

                        cell = (new Date(year, month, dayNum)).getDate();
                    }
                    // заполняем ячейку календаря
                    elem.appendChild(document.createTextNode(cell));
                    tr.appendChild(elem);
                }

                if ( row==5 && oneForwardShift==false && dayNum>=dayCount && col==7) {
                    dayCount += 7;
                    oneForwardShift = true;
                }
            }
            bodyCW.appendChild(table);

            //Кнопка Готово
            if ( this.calendarVar.tag == 'input' ) {
                var buttonComplete = document.createElement('div');
                buttonComplete.id = 'cw___buttonComplete';
                buttonComplete.textContent = 'готово';
                bodyCW.appendChild(buttonComplete);
            }


            //Создание завершено
            parent.appendChild(bodyCW);

            this.createPickupMonthYear();

            this.createControlButtonsEvent();

            this.repearDateAttr();

            this.updateInfobar();

            if ( !this.calendarVar.showInfoBar ) {
                $('#' + this.calendarVar.id + ' table').css('margin-top', '0');
            }
        },

        //Исправление дат в правильный формат
        repearDateAttr: function() {
            $( '#' + this.calendarVar.id + ' .cw___active' ).each(function() {
                var str = $(this).attr('d');
                str = str.split('.');
                var date = new Date(str[0], str[1], str[2]);
                str = date.getFullYear() + '.' + date.getMonth() + '.' + date.getDate();
                $(this).attr('d', str);
            });
        },

        //Перерисовка выделенной даты
        repaintSelectedDate: function() {
            $( '#' + this.calendarVar.id + ' .cw___active' ).removeClass('cw___selected');
            var strDate = this.calendarVar.selected.year + '.' + this.calendarVar.selected.month + '.' + this.calendarVar.selected.day;
            $( '#' + this.calendarVar.id + ' .cw___active[d="' + strDate + '"]' ).addClass('cw___selected');
        },

        fixCSS: function() {
            if (this.calendarVar.tag == 'input') {
                var objId = $( '#' + this.calendarVar.inputId );
                x = parseInt(objId.offset().left);
                y = parseInt(objId.offset().top);
                w = parseInt(objId.outerWidth(true));
                $( '#' + this.calendarVar.id ).css("left", (x + w + 1) + "px").css("top", (y) + "px");
            }
        },

        create: function(id, year, month, firstDayMondey, showInfoBar, onSelect, onFocus) {
            var obj = this;
            var objId = $( '#' + id );
            var tmpId;

            //Создание календаря или датапикера
            if ( objId.is('div') ) {

                this.calendarVar.tag = 'div';
                tmpId = id;

            } else if ( objId.is('input') ) {

                this.calendarVar.tag = 'input';
                tmpId = 'cw___' + id;
                objId.attr('idCW',tmpId);
                $('body').append( '<div id="' + tmpId + '" class="cw___hide cw___absolute cw___calendarWin"></div>' );

                x = parseInt(objId.offset().left);
                y = parseInt(objId.offset().top);
                w = parseInt(objId.outerWidth(true));
                $( '#' + tmpId ).css("left", (x + w + 1) + "px").css("top", (y) + "px");

                objId.focusin(obj, function() {
                    $( '#' + obj.calendarVar.id ).show();
                    obj.onFocus();
                });

                objId.keydown(obj, function() {
                    $( '#' + obj.calendarVar.id ).hide();
                });

                var body = $(document.body);
                body.on("mousedown", function(){
                    //Выполнение обработчика
                    $(document.body).triggerHandler('hide2');
                });

                //Вешаем свой обработчик
                body.on('hide2', function(e) {
                    $('.cw___calendarWin').hide();
                    $('.cw___blockMonth.cw___blockMonthMargin, .cw___blockYear.cw___blockMonthMargin').hide();
                })

                $( '#' + tmpId ).on("mousedown", function(e){
                    e.stopPropagation();
                });
            }

            this.calendarVar.inputId = id;
            this.calendarVar.id = tmpId;
            this.calendarVar.year = year*1;
            this.calendarVar.month = month*1;
            this.calendarVar.firstDayMondey = firstDayMondey;
            this.calendarVar.showInfoBar = showInfoBar;
            this.calendarVar.onSelect = onSelect;
            this.calendarVar.onFocus = onFocus;
            this.createCalendar(tmpId, year, month, firstDayMondey, showInfoBar);
        },

        onFocus: function() {
            if (this.calendarVar.onFocus) {
                this.calendarVar.onFocus();
                return true;
            }
            return false;
        },

        onSelect: function() {
            if (this.calendarVar.onSelect) {
                this.calendarVar.onSelect();
                return true;
            }
            return false;
        },

        updateInfobar: function() {
            if (this.calendarVar.selected.year == 0) {
                $( '#' + this.calendarVar.id + ' #cw___infobarWeek' ).text('\u00A0');
                $( '#' + this.calendarVar.id + ' #cw___infobarMonth' ).text('\u00A0');
                $( '#' + this.calendarVar.id + ' #cw___infobarDay' ).text('?');
                $( '#' + this.calendarVar.id + ' #cw___infobarYear' ).text('\u00A0');
                return
            }

            var weekDay = new Date(this.calendarVar.selected.year, this.calendarVar.selected.month, this.calendarVar.selected.day).getDay();
            weekDay = weekDay == 0 ? 7 : weekDay;
            weekDayStr = this.calendarVar.weekDayMondayFull[ weekDay - 1 ];
            $( '#' + this.calendarVar.id + ' #cw___infobarWeek' ).text(weekDayStr);

            var month = this.calendarVar.selected.month;
            month = this.calendarVar.monthName2[month];
            $( '#' + this.calendarVar.id + ' #cw___infobarMonth' ).text(month);

            var day = this.calendarVar.selected.day * 1;

            $( '#' + this.calendarVar.id + ' #cw___infobarDay' ).text(day);

            var year = this.calendarVar.selected.year;
            $( '#' + this.calendarVar.id + ' #cw___infobarYear' ).text(year);
        },

        isInt: function(n) {
            return n % 1 === 0;
        },

        normalizeInteger: function() {
            this.calendarVar.selected.year *= 1;
            this.calendarVar.selected.month *= 1;
            this.calendarVar.selected.day *= 1;
            this.calendarVar.year *= 1;
            this.calendarVar.month *= 1;
        },

        /*
         *  PUBLIC PROPERTY
         */

        setDateSelect: function(year, month, day) {
            if ( !this.isInt(year) || !this.isInt(month) || !this.isInt(day) ) { return };

            this.calendarVar.selected.year = year*1;
            this.calendarVar.selected.month = month*1;
            this.calendarVar.selected.day = day*1;
            this.repaintSelectedDate();

            this.calendarVar.year = year;
            this.calendarVar.month = month;
            this.createCalendar(this.calendarVar.id, this.calendarVar.year, this.calendarVar.month, this.calendarVar.firstDayMondey, this.calendarVar.showInfoBar);

            this.onSelect();
            this.updateInfobar();
        },

        resetDateSelect: function() {
            this.calendarVar.selected.year = 0;
            this.calendarVar.selected.month = 0;
            this.calendarVar.selected.day = 0;
            this.repaintSelectedDate();

            this.updateInfobar();
        },

        getDateSelect: function() {
            var dateObj = {
                year: 0,
                month: 0,
                day: 0
            }
            dateObj.year = this.calendarVar.selected.year + '';

            var mm = this.calendarVar.selected.month * 1 + 1 + '';
            mm = mm.length < 2 ? '0' + mm : mm;
            dateObj.month = mm;

            var dd = this.calendarVar.selected.day * 1 + '';
            dd = dd.length < 2 ? '0' + dd : dd;
            dateObj.day = dd;

            return dateObj;
        },

        getInputId: function() {
            return this.calendarVar.inputId;
        },

        changeLanguage: function(monthName, monthName2, weekDayMonday, weekDayMondayFull, completeText, firstDayMondey) {
            this.calendarVar.monthName = monthName;
            this.calendarVar.monthName2 = monthName2;
            this.calendarVar.weekDayMonday = weekDayMonday;
            this.calendarVar.weekDayMondayFull = weekDayMondayFull;
            this.calendarVar.completeText = completeText;
            this.calendarVar.firstDayMondey = firstDayMondey;

            this.createCalendar(this.calendarVar.id, this.calendarVar.year, this.calendarVar.month, this.calendarVar.firstDayMondey, this.calendarVar.showInfoBar);
        }
    }

    //Выделение даты
    this.setDateSelect = function(year, month, day) {
        calendarObj.fixCSS();
        calendarObj.setDateSelect(year, month, day);
        return true;
    }

    //Сброс выделения даты
    this.resetDateSelect = function() {
        calendarObj.resetDateSelect();
        return true;
    }

    //Получить выделенную дату в формате YYYY.mm.dd
    this.getDateSelect = function() {
        return calendarObj.getDateSelect();
    }

    //Сменить язык
    this.changeLanguage = function(monthName, monthName2, weekDayMonday, weekDayMondayFull, completeText, firstDayMondey) {
        return calendarObj.changeLanguage(monthName, monthName2, weekDayMonday, weekDayMondayFull, completeText, firstDayMondey);
    }

    //Получить Id input
    this.getInputId = function() {
        return calendarObj.getInputId();
    }

    calendarObj.create(id, year, month, firstDayMondey, showInfoBar, onSelect, onFocus);
}