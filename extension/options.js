/*
 * Export options shared by the popup and the reminder window: the same form
 * fields, stored in storage.local. Empty name / time zone mean "detect".
 */
/* global browser */
var ExportOptions = (function () {
  "use strict";
  var LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  // autoCapture: whether new meetings start with the capture (and close reminder) on.
  // Off by default: watching the chat can make Webex slower.
  var DEFAULTS = { format: "xlsx", includeDirect: true, myName: "", timezone: "", direction: "auto", autoCapture: false };

  function $(id) { return document.getElementById(id); }

  function validZone(tz) {
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch (e) { return false; }
  }

  async function load() {
    var o = await browser.storage.local.get(DEFAULTS);
    var radio = document.querySelector('input[name="format"][value="' + o.format + '"]');
    if (radio) radio.checked = true;
    if ($("includeDirect")) $("includeDirect").checked = o.includeDirect;
    $("myName").value = o.myName;
    $("timezone").value = o.timezone;
    $("timezone").placeholder = LOCAL_TZ;
    $("direction").value = o.direction;
    // these two change what happens during meetings, so they are saved right away
    if ($("autoCapture")) {
      $("autoCapture").checked = o.autoCapture;
      $("autoCapture").addEventListener("change", function () { browser.storage.local.set({ autoCapture: this.checked }); });
    }
    $("myName").addEventListener("change", function () { browser.storage.local.set({ myName: this.value.trim() }); });
    return o;
  }

  /* Reads the form; returns { error } when it can't be used. Saves it otherwise. */
  function read() {
    var o = {
      format: document.querySelector('input[name="format"]:checked').value,
      myName: $("myName").value.trim(),
      timezone: $("timezone").value.trim(),
      direction: $("direction").value
    };
    if ($("includeDirect")) o.includeDirect = $("includeDirect").checked;
    if (o.timezone && !validZone(o.timezone)) {
      return { error: "Unknown time zone “" + o.timezone + "”. Use a name like Europe/Berlin." };
    }
    browser.storage.local.set(o);
    return o;
  }

  return { load: load, read: read };
})();
