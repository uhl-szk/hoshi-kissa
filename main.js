(function () {
  var storageKey = "hoshiViewMode";
  var root = document.documentElement;
  var viewport = document.querySelector('meta[name="viewport"]');
  var buttons = document.querySelectorAll("[data-view-mode-button]");

  function saveMode(mode) {
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch (error) {
      return;
    }
  }

  function loadMode() {
    try {
      return window.localStorage.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function requestedMode() {
    try {
      var mode = new URLSearchParams(window.location.search).get("view");
      return mode === "pc" || mode === "sp" ? mode : null;
    } catch (error) {
      return null;
    }
  }

  function setMode(mode) {
    var nextMode = mode === "pc" ? "pc" : "sp";
    root.setAttribute("data-view-mode", nextMode);

    if (viewport) {
      viewport.setAttribute("content", nextMode === "pc" ? "width=1100" : "width=device-width, initial-scale=1");
    }

    buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-view-mode-button") === nextMode ? "true" : "false");
    });

    saveMode(nextMode);
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      setMode(button.getAttribute("data-view-mode-button"));
    });
  });

  var savedMode = loadMode();
  var initialMode = requestedMode() || (savedMode === "pc" || savedMode === "sp" ? savedMode : null);
  setMode(initialMode || (window.innerWidth <= 480 ? "sp" : "pc"));
})();

(function () {
  var inviteCode = "a26JJr3hVz";
  var totalElement = document.querySelector("[data-discord-total-count]");
  var breakdownElement = document.querySelector("[data-discord-breakdown]");

  if (!totalElement || !breakdownElement) {
    return;
  }

  var botCount = Number(breakdownElement.getAttribute("data-bot-count")) || 0;
  var discordApiUrl = "https://discord.com/api/v10/invites/" + inviteCode + "?with_counts=true&with_expiration=true";
  var countApiUrl = "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(discordApiUrl);

  function formatUpdatedAt(date) {
    var parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date).reduce(function (result, part) {
      result[part.type] = part.value;
      return result;
    }, {});

    return parts.month + "/" + parts.day + " " + parts.hour + ":" + parts.minute;
  }

  function updateCount(totalCount) {
    var humanCount = Math.max(totalCount - botCount, 0);
    totalElement.textContent = "現在の合計参加人数：" + totalCount + "人 (" + formatUpdatedAt(new Date()) + "更新)";
    breakdownElement.textContent = "Bot：" + botCount + "人・人間：" + humanCount + "人";
  }

  fetch(countApiUrl, { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("Discord count fetch failed");
      }
      return response.json();
    })
    .then(function (data) {
      var totalCount = Number(data.approximate_member_count || data.profile && data.profile.member_count);

      if (!Number.isFinite(totalCount)) {
        throw new Error("Discord count response is invalid");
      }

      updateCount(totalCount);
    })
    .catch(function () {
      totalElement.setAttribute("data-discord-count-status", "fallback");
      breakdownElement.setAttribute("data-discord-count-status", "fallback");
    });
})();
