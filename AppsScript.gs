/**
 * Google Apps Script - Creative Library Dashboard API
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone (or Anyone with link)
 */

function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0] && !row[3]) continue; // skip empty rows
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j].toString().trim().toLowerCase();
      var val = row[j];
      // Type conversions
      if (key === 'id') val = Number(val);
      if (key === 'effort') val = Number(val) || 0;
      if (key === 'beta') val = (val === true || val === 'TRUE' || val === 'Yes' || val === 'yes' || val === true);
      if (key === 'jira' && (!val || val === '-' || val === '')) val = null;
      obj[key] = val;
    }
    rows.push(obj);
  }

  // Read team members from column L (index 11)
  var team = [];
  for (var i = 1; i < data.length; i++) {
    var name = data[i][11]; // column L
    if (name && name.toString().trim()) team.push(name.toString().trim());
  }

  return ContentService
    .createTextOutput(JSON.stringify({ success: true, tasks: rows, team: team }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;

    if (action === 'updateStatus') {
      return updateTaskField(payload.id, 'status', payload.status);
    }

    if (action === 'updateField') {
      return updateTaskField(payload.id, payload.field, payload.value);
    }

    if (action === 'addTask') {
      return addTask(payload.task);
    }

    if (action === 'deleteTask') {
      return deleteTask(payload.id);
    }

    if (action === 'jiraQuery') {
      return jiraQuery(payload.jql, payload.fields, payload.maxResults);
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function updateTaskField(taskId, fieldName, newValue) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
  var idCol = headers.indexOf('id');
  var targetCol = headers.indexOf(fieldName.toLowerCase());

  if (idCol === -1) {
    return jsonResponse({ success: false, error: 'Missing id column' });
  }
  if (targetCol === -1) {
    return jsonResponse({ success: false, error: 'Unknown field: ' + fieldName });
  }

  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][idCol]) === Number(taskId)) {
      sheet.getRange(i + 1, targetCol + 1).setValue(newValue);
      return jsonResponse({ success: true, id: taskId, field: fieldName, value: newValue });
    }
  }

  return jsonResponse({ success: false, error: 'Task not found: ' + taskId });
}

function addTask(task) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var newRow = headers.map(function(h) {
    var key = h.toString().trim().toLowerCase();
    return task[key] !== undefined ? task[key] : '';
  });
  sheet.appendRow(newRow);
  return jsonResponse({ success: true, message: 'Task added' });
}

function deleteTask(taskId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('id');

  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][idCol]) === Number(taskId)) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ success: true, id: taskId, message: 'Task deleted' });
    }
  }

  return jsonResponse({ success: false, error: 'Task not found: ' + taskId });
}

// ==================== JIRA PROXY ====================
// To set up: Run setJiraCredentials() once from the Apps Script editor
// Or go to Project Settings > Script Properties and add:
//   JIRA_EMAIL = your.email@taboola.com
//   JIRA_TOKEN = your-api-token

function setJiraCredentials() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('JIRA_EMAIL', 'YOUR_EMAIL@taboola.com');
  props.setProperty('JIRA_TOKEN', 'YOUR_API_TOKEN');
  Logger.log('Jira credentials saved. Remember to update with real values!');
}

function jiraQuery(jql, fields, maxResults) {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('JIRA_EMAIL');
  var token = props.getProperty('JIRA_TOKEN');

  if (!email || !token) {
    return jsonResponse({ success: false, error: 'Jira credentials not configured. Run setJiraCredentials() in Apps Script editor.' });
  }

  var url = 'https://tbla.atlassian.net/rest/api/3/search/jql?jql=' + encodeURIComponent(jql)
    + '&fields=' + (fields || 'summary,status')
    + '&maxResults=' + (maxResults || 100);

  var resp = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Basic ' + Utilities.base64Encode(email + ':' + token),
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    return jsonResponse({ success: false, error: 'Jira API returned ' + code + ': ' + resp.getContentText().substring(0, 200) });
  }

  var data = JSON.parse(resp.getContentText());
  return jsonResponse({ success: true, total: data.total, issues: data.issues });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
