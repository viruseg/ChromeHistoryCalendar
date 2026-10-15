var month = [chrome.i18n.getMessage("month1"), chrome.i18n.getMessage("month2"), chrome.i18n.getMessage("month3"), chrome.i18n.getMessage("month4"), chrome.i18n.getMessage("month5"), chrome.i18n.getMessage("month6"), chrome.i18n.getMessage("month7"), chrome.i18n.getMessage("month8"), chrome.i18n.getMessage("month9"), chrome.i18n.getMessage("month10"), chrome.i18n.getMessage("month11"), chrome.i18n.getMessage("month12")];
var month2 = [chrome.i18n.getMessage("month21"), chrome.i18n.getMessage("month22"), chrome.i18n.getMessage("month23"), chrome.i18n.getMessage("month24"), chrome.i18n.getMessage("month25"), chrome.i18n.getMessage("month26"), chrome.i18n.getMessage("month27"), chrome.i18n.getMessage("month28"), chrome.i18n.getMessage("month29"), chrome.i18n.getMessage("month210"), chrome.i18n.getMessage("month211"), chrome.i18n.getMessage("month212")];
var week = [chrome.i18n.getMessage("week2"), chrome.i18n.getMessage("week3"), chrome.i18n.getMessage("week4"), chrome.i18n.getMessage("week5"), chrome.i18n.getMessage("week6"), chrome.i18n.getMessage("week7"), chrome.i18n.getMessage("week1")];
var week2 =[chrome.i18n.getMessage("week22"), chrome.i18n.getMessage("week23"), chrome.i18n.getMessage("week24"), chrome.i18n.getMessage("week25"), chrome.i18n.getMessage("week26"), chrome.i18n.getMessage("week27"), chrome.i18n.getMessage("week21")];
var calendar;
var date = new Date();
var tempDay;
var tempMonth;
var tempYear;
var content;
var menu;
var menu2;
var searchText;
var visitTime;
var mainMode;
var body;
var globalDay;
var globalMonth;
var globalYear;
var searchInput;
var removeSelected;
var delArr;
var globalColor;
var clearBrowsingData;
var historyUrl;
var historyDomen;
var blackListButton;
var staticButton;
var blackListBlock;
var staticBlock;
var blackListUrl;
var blackListCaption;
var clearText;
var load = false;
var runed = false;
var searchMore;
var searchBlock;
var calendarStart;
var calendarEnd;
var interval = false;
var searchText2;
var searchInput2;

if (localStorage["BlackListCaption"]==undefined) localStorage["BlackListCaption"] = '';
if (localStorage["BlackListUrl"]==undefined) localStorage["BlackListUrl"] = '';

document.title = chrome.i18n.getMessage("title");

$(document).ready(function() {
    content = $('#content');
    menu = $('#action-menu');
    menu2 = $('#action-menu2');
    searchText = $('#search-text');
    searchInput = $('#search-input');
    removeSelected = $('#remove-selected');
    clearBrowsingData = $('#clear-browsing-data');
    historyUrl = $('#history-url');
    historyDomen = $('#history-domen');
    blackListButton = $('#blackList');
    staticButton = $('#static');
    blackListBlock = $('#blackListBlock');
    staticBlock = $('#staticBlock');
    blackListUrl = $('#BlackListUrl');
    blackListCaption = $('#BlackListCaption');
    clearText = $('#clear-text');
    searchMore = $('#search-more');
    searchBlock = $('#searchBlock');
    searchText2 = $('#search-text2');
    searchInput2 = $('#search-input2');

    clearBrowsingData.val( chrome.i18n.getMessage("clearbrowsingdata") );
    removeSelected.val( chrome.i18n.getMessage("removeselected") );
    searchInput.val( chrome.i18n.getMessage("searchinput") );
    historyUrl.text( chrome.i18n.getMessage("historyurl") );
    historyDomen.text( chrome.i18n.getMessage("historydomen") );
    $('p.attention').html(chrome.i18n.getMessage("i18n_blackListUrl_4"));
    $('#i18n_blackListUrl_1').text(chrome.i18n.getMessage("i18n_blackListUrl_1"));
    $('#i18n_blackListUrl_2').text(chrome.i18n.getMessage("i18n_blackListUrl_2"));
    $('#i18n_blackListUrl_3').text(chrome.i18n.getMessage("i18n_blackListUrl_3"));
    $('#i18n_blackListUrl_5').text(chrome.i18n.getMessage("i18n_blackListUrl_5"));
    $('#i18n_blackListUrl_6').text(chrome.i18n.getMessage("i18n_blackListUrl_6"));
    $('#i18n_blackListUrl_7').text(chrome.i18n.getMessage("i18n_blackListUrl_7"));
    blackListButton.val(chrome.i18n.getMessage("blackList"));
    staticButton.val(chrome.i18n.getMessage("diag1"));
    $('#staticLabel').text(chrome.i18n.getMessage("diag9"));
    $('#del10min').text(chrome.i18n.getMessage("del10min"));
    $('#del1hour').text(chrome.i18n.getMessage("del1hour"));
    $('#del12hours').text(chrome.i18n.getMessage("del12hours"));
    $('#del1day').text(chrome.i18n.getMessage("del1day"));
    $('#del7day').text(chrome.i18n.getMessage("del7day"));
    $('#del1month').text(chrome.i18n.getMessage("del1month"));
    $('#delAll').text(chrome.i18n.getMessage("delAll"));
    $('#intervalCaption1').text(chrome.i18n.getMessage("intervalCaption1"));
    $('#intervalCaption2').text(chrome.i18n.getMessage("intervalCaption2"));
    searchInput2.val(chrome.i18n.getMessage("buttonInterval"));
    $('#searchLabel').text(chrome.i18n.getMessage("searchLabel"));
    searchText2.attr('placeholder', chrome.i18n.getMessage("searchPlaceholder"));

    if (chrome.i18n.getMessage("l") == 'zh_CN') {
        content.addClass('zh');
        searchInput.addClass('search-input');
        searchText.addClass('search-text');
        removeSelected.addClass('remove-selected');
        searchBlock.addClass('zhW');
    }


    setTimeout(function() {
        document.body.scrollTop = 0;
    }, 200);

    calendar = new createCalendarObj('calendar', date.getFullYear(), date.getMonth(), true, true, function() {
        var dateObj = calendar.getDateSelect();
        tempDay = dateObj.day;
        tempMonth = dateObj.month-1;
        tempYear = dateObj.year;
        searchText.val('');
        clearText.addClass('hide');

        globalDay = tempDay;
        globalMonth = tempMonth;
        globalYear = tempYear;

        mainMode = true;

        hideAll();

        getArrHistoryDay(tempDay, tempMonth, tempYear, '', true, false);
    });

    calendar.setDateSelect( date.getFullYear(), date.getMonth(), date.getDate() );

    var firstMonday = false;
    if (chrome.i18n.getMessage("firstMonday") === 'true') {
        firstMonday = true;
    }

    calendar.changeLanguage(month2, month, week2, week, chrome.i18n.getMessage("complete"), firstMonday);

    historyUrl.click(function() {
        hideAll();
        calendar.resetDateSelect();
        searchText.val(menu.attr('a-url'));
        clearText.removeClass('hide');

        mainMode = false;

        getArrVisitsUrl(menu.attr('a-url'));
    });

    historyDomen.click(function() {
        hideAll();
        calendar.resetDateSelect();
        searchText.val(menu.attr('a-domen'));
        clearText.removeClass('hide');

        mainMode = false;

        getArrHistoryDay(0, 0, 1970, menu.attr('a-domen'), true, false);
    });

    searchInput.click(function() {
        searchClick();
    });

    searchInput2.click(function() {
        searchClick2();
    });

    searchText.keypress(function (e) {
        if (e.which == 13) {
            searchClick();
        }
    });

    body = $(document.body);
    body.on("mousedown", function(){
        $(this).triggerHandler('hide3');
        $(this).triggerHandler('hide4');
    });
    body.on('hide3', function(e) {
        menu.hide();
    });
    body.on('hide4', function(e) {
        menu2.hide();
    });
    $('#history-url, #history-domen, #action-menu2>div').on("mousedown", function(e){
        e.stopPropagation();
    });

    setInterval(function() {
        if ( load && !runed && mainMode &&  body.height() - document.documentElement.clientHeight < window.pageYOffset + document.documentElement.clientHeight - 300) {
            globalDay--;
            runed = true;
            getArrHistoryDay(globalDay, globalMonth, globalYear, '', false, false);
        }
    }, 300);

    removeSelected.click(function() {
        if (delArr.length > 0) {
            if (visitTime) {
                for (var i=0; i<delArr.length; i++) {
                    var int = Math.floor( +delArr[i] );
                    var deleteObj = {
                        'startTime': int,
                        'endTime': ++int
                    };

                    chrome.history.deleteRange(deleteObj, function() {});
                }
            } else {
                for (var i=0; i<delArr.length; i++) {
                    var deleteObj = {
                        'url': delArr[i]
                    };

                    chrome.history.deleteUrl(deleteObj);
                }
            }
            $( ".chk:checked").prop('checked', false).attr('disabled', 'disabled').parent().addClass('del');
            removeSelected.attr('disabled', 'disabled');
        }
    });

    blackListButton.click(function() {
        hideAll();
        blackListUrl.val(localStorage["BlackListUrl"]);
        blackListCaption.val(localStorage["BlackListCaption"]);
        blackListBlock.show();
    });

    blackListUrl.keyup(function() {
        localStorage["BlackListUrl"] = blackListUrl.val();
    });

    blackListCaption.keyup(function() {
        localStorage["BlackListCaption"] = blackListCaption.val();
    });

    searchText.keyup(function() {
        if ( $(this).val() ) {
            clearText.removeClass('hide');
        } else {
            clearText.addClass('hide');
        }
    });

    clearText.click(function() {
        location.reload();
    });

    staticButton.click(function() {
        hideAll();
        $('#staticEntryBlock').html('').removeClass('bckgNone');
        getStatic();
        staticBlock.show();
    });

    searchMore.click(function() {
        initInterval();
        searchText2.val( searchText.val() );
        hideAll();
        getStatic();
        searchBlock.show();
    });

    $('.window .close').click(function() {
        $(this).parent().hide()
    });

    clearBrowsingData.click(function(e) {
        var relativeX = e.clientX;
        var relativeY = e.clientY;

        menu2.css({ top:relativeY, left:relativeX });
        menu2.show();
        menu.hide();
    });

    $('#action-menu2>div').click(function() {
        var action = $(this).attr("del");
        delHistoryRange(action);
    });

    $(window).resize(function(){
        setXmoresearch();
    });
    setXmoresearch();
});

function searchClick() {
    if (!searchText.val()) return;

    hideAll();
    calendar.resetDateSelect();

    mainMode = false;

    getArrHistoryDay(0, 0, 1970, searchText.val(), true, false);
}

function hideAll() {
    $('.window').hide();
    menu.hide();
    menu2.hide();
}

function getArrHistoryDay(d, m, y, text, clear, interval) {
    if (clear) {
        content.html('');
        document.body.scrollTop = 0;
        delArr = [];
        removeSelected.attr('disabled', 'disabled');
    }

    visitTime = false;

    var timeStart = new Date(y,m,d,0,0,0);
    var timeEnd = new Date(y,m,d,23,59,59,9999);

    if (y === 1970) {
        if (!interval) {
            timeStart = new Date(1970,0,1,0,0,0);
            timeEnd = new Date();
        } else {
            var dateObjStart = calendarStart.getDateSelect();
            timeStart = new Date(dateObjStart.year,dateObjStart.month-1,dateObjStart.day,0,0,0);
            var dateObjEnd = calendarEnd.getDateSelect();
            timeEnd = new Date(dateObjEnd.year,dateObjEnd.month-1,dateObjEnd.day,23,59,59,9999);
        }

    } else {
        var weekDay = timeStart.getDay()-1 === -1 ? 6 : timeStart.getDay()-1;
        var str = timeStart.getDate() + ' ' + month[timeStart.getMonth()] + ' ' + timeStart.getFullYear() + ', ' + week[weekDay];
        str = '<div class="lineDate">' + str + '</div>';

        content.append(str);
    }

    timeStart = timeStart.getTime();
    timeEnd = timeEnd.getTime();

    var searchObj = {
        'text': text,
        'startTime': timeStart,
        'endTime': timeEnd,
        'maxResults': 0
    };

    globalColor = false;

    chrome.history.search(searchObj, function(results){
        var count = 0;
        results.forEach(function(item, i, results) {
            var cont = false;
            if ( checkBlackList(item.title, localStorage["BlackListCaption"]) || checkBlackList(item.url, localStorage["BlackListUrl"]) ) cont = true;

            if (!cont) {
                var date = new Date(item.lastVisitTime);

                var hh = date.getHours() + '';
                hh = hh.length < 2 ? '0' + hh : hh;
                var mm = date.getMinutes() + '';
                mm = mm.length < 2 ? '0' + mm : mm;

                var domen = item.url.split(/\/+/g)[1];

                date = date.getDate() + ' ' + month[date.getMonth()] + ' ' + hh + ':' + mm;

                var str = prepareHtml(date, item.url, item.title, domen, 0);

                content.append(str);

                setClick();
                setColorLine();
            } else {
                count++;
            }
        });

        if (!results.length || results.length == count) {
            str = '<div class="line">' + chrome.i18n.getMessage("noFind") + '</div>';
            content.append(str);
            setColorLine();
        }

        load = true;
        runed = false;
    })
}

function getArrVisitsUrl(url) {
    content.html('');
    document.body.scrollTop = 0;

    visitTime = true;
    delArr = [];
    removeSelected.attr('disabled', 'disabled');

    var searchObj = {
        'url': url
    };

    globalColor = false;

    chrome.history.getVisits(searchObj, function(results){
        results = results.reverse();
        var count = 0;

        results.forEach(function(item, i, results) {
            var url = menu.attr('a-url');
            var title = menu.attr('a-title');

            var cont = false;
            if ( checkBlackList(title, localStorage["BlackListCaption"]) || checkBlackList(url, localStorage["BlackListUrl"]) ) cont = true;

            if (!cont) {
                var date = new Date(item.visitTime);

                var hh = date.getHours() + '';
                hh = hh.length < 2 ? '0' + hh : hh;
                var mm = date.getMinutes() + '';
                mm = mm.length < 2 ? '0' + mm : mm;

                var domen = url.split(/\/+/g)[1];

                date = date.getDate() + ' ' + month[date.getMonth()] + ' ' + hh + ':' + mm;

                var str = prepareHtml(date, url, title, domen, item.visitTime);

                content.append(str);

                setClick();
                setColorLine();
            } else {
                count++;
            }
        });

        if (!results.length || results.length == count) {
            str = '<div class="line">' + chrome.i18n.getMessage("noFind") + '</div>';
            content.append(str);
            setColorLine();
        }
    })
}

/**
 * Builds a URL of the site's icon served by the extension's `_favicon` endpoint.
 *
 * @param {string} pageUrl - Address of the site whose icon is needed.
 * @returns {string} Absolute URL usable as a CSS `background-image` value.
 */
function getFaviconUrl(pageUrl) {
    return chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(pageUrl) + '&size=16';
}

function prepareHtml(date, url, title, domen, time) {
    var timeStr = '';
    if (time > 0) {
        timeStr = ' a-time="' + time + '"';
    }

    var hint = '';
    if (!visitTime) {
        hint = chrome.i18n.getMessage("lastVisit");
    }

    var urlDecoded = '';
    try {
        urlDecoded = decodeURIComponent(url);
    } catch (e) {
        urlDecoded = url;
    }

    var str =  '<div class="line">\
                    <div class="time" title="' + hint + '">' + date + '</div>\
                    <input type="checkbox" class="chk" a-url="' + url + '"' + timeStr + '>\
                    <a href="' + url + '"  target="_blank">\
                        <div class="icon" style="background-image: url(\'' + getFaviconUrl(url) + '\');"></div>\
                        <div class="head">' + HTML.encode(title) + '</div>\
                        <div class="url">' + urlDecoded + '</div>\
                    </a>\
                    <div class="menu" a-url="' + url + '" a-domen="' + domen + '" a-title="' + title + '"></div>\
                </div>';
    return str;
}

function setClick() {
    $('.menu:not(.done)').click(function(e) {
        var relativeX = e.clientX;
        var relativeY = e.clientY;

        menu.css({ top:relativeY, left:relativeX });
        menu.show();
        menu.attr('a-domen', $(this).attr('a-domen'));
        menu.attr('a-url', $(this).attr('a-url'));
        menu.attr('a-title', $(this).attr('a-title'));
    }).addClass('done');

    $('.chk:not(.done)').click(function() {
        var allChecked = $( ".chk:checked" );
        if (allChecked.length > 0) {
            removeSelected.removeAttr('disabled');
            delArr = [];
            allChecked.each(function() {
                if (visitTime) {
                    delArr.push( $(this).attr('a-time') );
                } else {
                    delArr.push( $(this).attr('a-url') );
                }
            })
        } else {
            removeSelected.attr('disabled', 'disabled');
        }
    }).addClass('done');
}

function setColorLine() {
    $('.line:not(.done)').each(function() {
        if (globalColor) {
            $(this).css({ 'background-color': 'rgba(0, 0, 0, .05)' });
        } else {
            $(this).css({ 'background-color': '#FFF' });
        }
        globalColor = !globalColor;
    }).addClass('done');
}

function checkBlackList(str, list) {
    var arr = list.split("\n");
    if (arr.length==1 && arr[0]=='') {
        return false;
    }

    if (arr) {
        for (var i=0, z1_end = arr.length; i<z1_end; i++) {
            if(arr[i]!='' && str.toLocaleLowerCase().indexOf( arr[i].toLocaleLowerCase() ) + 1) {
                return true;
            }
        }
    }

    return false;
}

function getStatic() {
    var timeStart = new Date(1970,0,1,0,0,0);
    var timeEnd = new Date();

    timeEnd = timeEnd.getTime();
    timeStart = timeStart.getTime();

    var searchObj = {
        'text': "",
        'startTime': timeStart,
        'endTime': timeEnd,
        'maxResults': 0
    };

    chrome.history.search(searchObj, function(results) {
        var dict = { discards: 0, total: 0, items: {} };
        for(var i = 0;  i < results.length; ++i) {
            if (checkBlackList(results[i].url, localStorage["BlackListUrl"])) continue;
            var hash = hashURL( results[i].url );
            if(typeof hash != "undefined") {
                var count = results[i].visitCount;
                if (count==0) {count++}
                dict.total += count;
                if(typeof dict.items[hash] == "undefined") {
                    dict.items[hash] = count;
                }
                else {
                    dict.items[hash] += count;
                }
            }
            else {
                dict.discards++;
            }
        }

        dict.data = [];
        for(var prop in dict.items) {
            if(dict.items.hasOwnProperty(prop)) {
                dict.data.push( [prop, dict.items[prop]] );
            }
        }
        dict.data.sort( function(a,b) { return a[1] - b[1] } );

        var str = '';
        for (var j=0, i_end=dict.data.length; j<i_end; j++) {
            str = "<div class='entry'><div class='cap3'>"+dict.data[j][0]+"</div><div class='cap4'>"+dict.data[j][1]+"</div></div>" + str;
        }

        str = "<div id='static_head'>"+chrome.i18n.getMessage("diag14")+dict.total+"</div>" + str;

        $('#staticEntryBlock').html(str).addClass('bckgNone');
    });
}

function hashURL(url) {
    if(typeof url != "undefined") {
        var str = url
        if (str.match(/^about:/) != null) {
            return chrome.i18n.getMessage("diag12")
        } else {
            str = url.split(/\/+/g)[1]
            //console.log(url)
            if (str.match(/^[A-Z]{1}:/) != null) {
                return chrome.i18n.getMessage("diag11")
            } else if (str.match(/^[a-z]{32}$/) != null) {
                return chrome.i18n.getMessage("diag13")
            } else if (str.match(/;base64,/) != null) {
                return 'MIME'
            } else {
                return str
            }
        }
    }
    else {
        return;
    }
}

function delHistoryRange(action) {
    var timeStart = new Date();
    var timeEnd = new Date();

    switch (action) {
        case '10min':
            timeStart.setMinutes( timeStart.getMinutes() - 10 );
            break;
        case '1hour':
            timeStart.setHours( timeStart.getHours() - 1 );
            break;
        case '12hours':
            timeStart.setHours( timeStart.getHours() - 12 );
            break;
        case '1day':
            timeStart.setDate( timeStart.getDate() - 1 );
            break;
        case '7day':
            timeStart.setDate( timeStart.getDate() - 7 );
            break;
        case '1month':
            timeStart.setMonth( timeStart.getMonth() - 1 );
            break;
        case 'All':
            timeStart = new Date(1970,0,1,0,0,0);
            break;
    }

    timeStart = timeStart.getTime();
    timeEnd = timeEnd.getTime();

    hideAll();

    var deleteObj = {
        'startTime': timeStart,
        'endTime': timeEnd
    };

    chrome.history.deleteRange(deleteObj, function() {
        location.reload();
    });
}

function setXmoresearch() {
    var left = searchText.offset().left;
    var width = searchMore.width();
    searchMore.css('left', 'calc(' + (left - width) + 'px - .2rem)');
}

function initInterval() {
    if (interval) return;

    var date = new Date();
    var timeStart = new Date();
    timeStart.setDate( timeStart.getDate() - 7 );

    calendarStart = new createCalendarObj('calendarStart', timeStart.getFullYear(), timeStart.getMonth(), true, false);
    calendarEnd = new createCalendarObj('calendarEnd', date.getFullYear(), date.getMonth(), true, false);

    calendarStart.setDateSelect( timeStart.getFullYear(), timeStart.getMonth(), timeStart.getDate() );
    calendarEnd.setDateSelect( date.getFullYear(), date.getMonth(), date.getDate() );

    var firstMonday = false;
    if (chrome.i18n.getMessage("firstMonday") === 'true') {
        firstMonday = true;
    }

    calendar.changeLanguage(month2, month, week2, week, chrome.i18n.getMessage("complete"), firstMonday);
    calendarStart.changeLanguage(month2, month, week2, week, chrome.i18n.getMessage("complete"), firstMonday);
    calendarEnd.changeLanguage(month2, month, week2, week, chrome.i18n.getMessage("complete"), firstMonday);

    interval = true;
}

function searchClick2() {
    searchText.val( searchText2.val() );

    hideAll();
    calendar.resetDateSelect();

    mainMode = false;

    getArrHistoryDay(0, 0, 1970, searchText2.val(), true, true);
}