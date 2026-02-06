// ==================================================
//  GAS API バックエンド (Ver 3.0: 検索強化版)
// ==================================================

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return responseJSON({ status: 'active' });
}

function doPost(e) {
  var params = {};
  try {
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return responseJSON({ error: 'JSON Parse Error', detail: err.toString() });
  }

  var result = {};
  var action = params.action;

  try {
    if (action === 'getFileContent') {
      result = fetchContentInternal(params.path, params.token, params.owner, params.repo);
    }
    else if (action === 'saveFileContent') {
      result = saveContentInternal(params.path, params.content, params.sha, params.token, params.owner, params.repo);
    }
    else if (action === 'getAvailableCalendars') {
      result = getAvailableCalendars();
    }
    else if (action === 'getCalendarEvents') {
      var cals = params.calendarIds;
      if (typeof cals === 'string') {
        try { cals = JSON.parse(cals); } catch(e) { cals = []; }
      }
      result = getCalendarEvents(params.startStr, params.endStr, cals);
    }
    else if (action === 'createCalendarEvent') {
      result = createCalendarEvent(params);
    }
    else if (action === 'updateCalendarEvent') {
      result = updateCalendarEvent(params);
    }
    else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: 'Server Error', detail: err.toString() };
  }

  return responseJSON(result);
}

// --- Logic ---

function fetchContentInternal(path, token, owner, repo) {
  if (!token || !owner || !repo || !path) return { error: 'Missing Config' };
  var url = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;
  var options = {
    'method': 'get',
    'headers': { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' },
    'muteHttpExceptions': true
  };
  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() === 404) return { content: '', sha: null };
  if (response.getResponseCode() !== 200) return { error: 'GitHub Error: ' + response.getContentText() };
  
  var json = JSON.parse(response.getContentText());
  var decoded = Utilities.newBlob(Utilities.base64Decode(json.content)).getDataAsString('UTF-8');
  return { content: decoded, sha: json.sha };
}

function saveContentInternal(path, content, sha, token, owner, repo) {
  var url = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;
  var headers = { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' };

  if (!sha) {
    var check = UrlFetchApp.fetch(url, { 'method': 'get', 'headers': headers, 'muteHttpExceptions': true });
    if (check.getResponseCode() === 200) sha = JSON.parse(check.getContentText()).sha;
  }

  var blob = Utilities.newBlob(content, 'text/plain', 'UTF-8');
  var payload = { 'message': 'Update via WebApp', 'content': Utilities.base64Encode(blob.getBytes()) };
  if (sha) payload.sha = sha;

  var options = {
    'method': 'put', 'headers': headers, 'contentType': 'application/json',
    'payload': JSON.stringify(payload), 'muteHttpExceptions': true
  };
  var res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() === 409) { 
      var retryGet = UrlFetchApp.fetch(url, { 'method': 'get', 'headers': headers, 'muteHttpExceptions': true });
      if (retryGet.getResponseCode() === 200) {
        payload.sha = JSON.parse(retryGet.getContentText()).sha;
        options.payload = JSON.stringify(payload);
        res = UrlFetchApp.fetch(url, options);
      }
  }
  if (res.getResponseCode() >= 300) return { error: 'Save failed: ' + res.getContentText() };
  return { success: true, newSha: JSON.parse(res.getContentText()).content.sha };
}

function getAvailableCalendars() {
  try {
    return CalendarApp.getAllCalendars().map(function(c) {
      return { id: c.getId(), name: c.getName(), color: c.getColor(), isDefault: c.isMyPrimaryCalendar() };
    });
  } catch (e) { return { error: e.toString() }; }
}

function getCalendarEvents(startStr, endStr, calendarIds) {
  try {
    var targets = [];
    if (calendarIds && calendarIds.length) {
      targets = calendarIds.map(function(id){ return CalendarApp.getCalendarById(id); }).filter(function(c){return c;});
    } else {
      var def = CalendarApp.getDefaultCalendar();
      if(def) targets.push(def);
    }
    if (!targets.length) return { events: [] };

    var start = new Date(startStr);
    var end = new Date(endStr);
    end.setHours(23, 59, 59);

    var all = [];
    targets.forEach(function(cal) {
      var events = cal.getEvents(start, end);
      var mapped = events.map(function(e) {
        return {
          id: e.getId(), title: e.getTitle(), desc: e.getDescription(),
          start: e.getStartTime().toISOString(), end: e.getEndTime().toISOString(),
          isAllDay: e.isAllDayEvent(), location: e.getLocation(),
          isGCal: true, calendarId: cal.getId(), calendarName: cal.getName(), color: cal.getColor()
        };
      });
      all = all.concat(mapped);
    });
    return { events: all };
  } catch (e) { return { error: e.toString() }; }
}

function createCalendarEvent(params) {
  try {
    var calId = params.targetCalendarId || params.calendarId;
    if (!calId) return { error: 'Calendar ID missing' };
    var cal = CalendarApp.getCalendarById(calId);
    if (!cal) return { error: 'Calendar not found' };

    var title = params.title || 'No Title';
    var desc = params.description || '';
    
    if (params.startTime === null) {
       cal.createAllDayEvent(title, new Date(params.dateStr), {description: desc});
    } else {
       var s = new Date(params.dateStr + 'T' + params.startTime);
       var e = new Date(params.dateStr + 'T' + params.endTime);
       cal.createEvent(title, s, e, {description: desc});
    }
    return { success: true };
  } catch(e) { return { error: e.toString() }; }
}

// ★修正強化版: ID検索ロジック改善
function updateCalendarEvent(params) {
  try {
    var calId = params.calendarId;
    var eid = params.eventId || params.eid;
    if (!calId || !eid) return { error: 'ID missing' };

    var cal = CalendarApp.getCalendarById(calId);
    if (!cal) return { error: 'Calendar not found' };

    // 1. まず通常のID指定で取得を試みる
    var evt = null;
    try { evt = cal.getEventById(eid); } catch(ex) {}

    // 2. 見つからない場合、その日のイベント全件からIDが一致するものを探す（iOS/Mac同期の不具合回避）
    if (!evt && params.dateStr) {
        var d = new Date(params.dateStr);
        // 前後1日の余裕を持って検索
        var searchStart = new Date(d); searchStart.setDate(d.getDate() - 1);
        var searchEnd = new Date(d); searchEnd.setDate(d.getDate() + 1);
        
        var candidates = cal.getEvents(searchStart, searchEnd);
        for (var i = 0; i < candidates.length; i++) {
            // IDが完全一致するか、Google特有のサフィックス違いなどを考慮して部分一致で探す
            if (candidates[i].getId() === eid || candidates[i].getId().indexOf(eid) !== -1) {
                evt = candidates[i];
                break;
            }
        }
    }
    
    if (!evt) return { error: 'Event not found: ' + eid };

    if (params.title) evt.setTitle(params.title);
    if (params.description !== undefined) evt.setDescription(params.description);

    if (params.dateStr) {
        if (params.startTime === null) {
            evt.setAllDayDate(new Date(params.dateStr));
        } else if (params.startTime && params.endTime) {
            var s = new Date(params.dateStr + 'T' + params.startTime);
            var e = new Date(params.dateStr + 'T' + params.endTime);
            evt.setTime(s, e);
        }
    }
    return { success: true };
  } catch(e) { return { error: e.toString() }; }
}